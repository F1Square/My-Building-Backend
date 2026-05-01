const crypto = require('crypto');
const supabase = require('../supabase');
const ns = require('../utils/notificationService');

// GET /maintenance/advance/status
// Returns credit_balance, months_covered, monthly_amount, ledger for current user
exports.getAdvanceStatus = async (req, res) => {
  const user_id = req.user.id;
  const building_id = req.user.building_id;
  if (!building_id) return res.status(400).json({ error: 'User has no building assigned' });

  const [{ data: creditRow }, { data: latestBill }, { data: ledger }] = await Promise.all([
    supabase
      .from('advance_credit_balance')
      .select('credit_balance')
      .eq('user_id', user_id)
      .eq('building_id', building_id)
      .single(),
    supabase
      .from('maintenance_bills')
      .select('amount')
      .eq('building_id', building_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from('advance_credit_ledger')
      .select('*, advance_payment_orders(months, razorpay_payment_id)')
      .eq('user_id', user_id)
      .eq('building_id', building_id)
      .order('created_at', { ascending: false }),
  ]);

  const credit_balance = Number(creditRow?.credit_balance || 0);
  const monthly_amount = latestBill?.amount ? Number(latestBill.amount) : null;
  const months_covered = monthly_amount && monthly_amount > 0
    ? Math.floor(credit_balance / monthly_amount)
    : 0;

  res.json({ credit_balance, months_covered, monthly_amount, ledger: ledger || [] });
};

// POST /maintenance/advance/order
// Body: { months: 1|3|6|12 }
exports.createAdvanceOrder = async (req, res) => {
  const { months } = req.body;
  const user_id = req.user.id;
  const building_id = req.user.building_id;

  if (!building_id) return res.status(400).json({ error: 'User has no building assigned' });

  const validMonths = [1, 3, 6, 12];
  if (!validMonths.includes(Number(months))) {
    return res.status(422).json({ error: 'Invalid advance period. Must be 1, 3, 6, or 12 months' });
  }

  // Fetch latest bill amount for the building
  const { data: latestBill } = await supabase
    .from('maintenance_bills')
    .select('amount')
    .eq('building_id', building_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!latestBill?.amount) {
    return res.status(422).json({ error: 'No billing amount configured for this building' });
  }

  const monthly_amount = Number(latestBill.amount);
  const total_amount = monthly_amount * Number(months);

  // Fetch user + building info for Razorpay notes
  const [{ data: userRow }, { data: buildingRow }] = await Promise.all([
    supabase.from('users').select('name, flat_no, phone').eq('id', user_id).single(),
    supabase.from('buildings').select('name').eq('id', building_id).single(),
  ]);

  try {
    // Insert pending order row FIRST so we have the ID for the callback
    const { data: orderRow, error: insertErr } = await supabase
      .from('advance_payment_orders')
      .insert({
        user_id,
        building_id,
        months: Number(months),
        monthly_amount,
        total_amount,
        status: 'pending',
        // razorpay_order_id will be updated below with merchantTransactionId
      })
      .select()
      .single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    const { generatePaymentRequest } = require('../utils/phonepeHelper');
    const merchantTransactionId = `ADV_${orderRow.id.replace(/-/g, '')}_${Date.now()}`.substring(0, 34);
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) return res.status(500).json({ error: 'BACKEND_URL not set in .env' });

    // Update order with the generated transaction ID
    await supabase.from('advance_payment_orders')
      .update({ razorpay_order_id: merchantTransactionId })
      .eq('id', orderRow.id);

    const redirectUrl = `${backendUrl}/api/maintenance/advance/phonepe-callback?order_row_id=${orderRow.id}&txn_id=${merchantTransactionId}`;

    const phonepeResponse = await generatePaymentRequest({
      merchantTransactionId,
      amount: total_amount, // already in rupees
      userId: user_id,
      mobileNumber: userRow?.phone || "9999999999",
      redirectUrl
    });

    if (phonepeResponse.success) {
      res.json({ 
        order_id: merchantTransactionId, 
        checkout_url: phonepeResponse.data.instrumentResponse.redirectInfo.url, 
        total_amount, 
        monthly_amount, 
        months 
      });
    } else {
      res.status(500).json({ error: 'PhonePe API error: ' + phonepeResponse.message });
    }
  } catch (err) {
    console.error('PhonePe advance order error:', err);
    res.status(500).json({ error: 'Failed to create payment order: ' + err.message });
  }
};

// PhonePe Callback
exports.phonepeCallback = async (req, res) => {
  const { order_row_id, txn_id } = req.query;

  try {
    const { checkPaymentStatus } = require('../utils/phonepeHelper');
    const statusData = await checkPaymentStatus(txn_id);

    if (statusData && statusData.code === 'PAYMENT_SUCCESS') {
      const razorpay_payment_id = statusData.data.transactionId;

  // Fetch the order row
  const { data: orderRow, error: fetchErr } = await supabase
    .from('advance_payment_orders')
    .select('*')
    .eq('id', order_row_id)
    .single();

  if (fetchErr || !orderRow) {
    return res.json({ success: false, error: 'Order not found' });
  }

  // Idempotency: already paid — return success without re-crediting
  if (orderRow.status === 'paid') {
    return res.json({ success: true });
  }

  const { user_id, building_id, total_amount } = orderRow;

  // Update order to paid
  await supabase
    .from('advance_payment_orders')
    .update({
      status: 'paid',
      razorpay_payment_id,
      paid_at: new Date().toISOString(),
    })
    .eq('id', order_row_id);

  // Fetch current credit balance
  const { data: creditRow } = await supabase
    .from('advance_credit_balance')
    .select('credit_balance')
    .eq('user_id', user_id)
    .eq('building_id', building_id)
    .single();

  const previousBalance = Number(creditRow?.credit_balance || 0);
  const newBalance = previousBalance + Number(total_amount);

  // UPSERT credit balance
  await supabase
    .from('advance_credit_balance')
    .upsert(
      { user_id, building_id, credit_balance: newBalance, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,building_id' }
    );

  // Insert credit ledger row
  await supabase.from('advance_credit_ledger').insert({
    user_id,
    building_id,
    transaction_type: 'credit',
    amount: Number(total_amount),
    balance_after: newBalance,
    advance_order_id: order_row_id,
    description: `Advance payment for ${orderRow.months} month${orderRow.months > 1 ? 's' : ''}`,
  });

  // Send notification
  const months = orderRow.months;
  await ns.notifyUser(user_id, {
    title: '💰 Advance Payment Confirmed',
    body: `₹${Number(total_amount).toLocaleString('en-IN')} credited for ${months} month${months > 1 ? 's' : ''} of advance maintenance. Your credit balance is now ₹${newBalance.toLocaleString('en-IN')}.`,
    type: 'advance_credited',
    meta: { advance_order_id: order_row_id },
  });

  // Settle any existing pending/partial bills for this user using the new credit
  try {
    const settleAdvanceCredit = require('../utils/settleAdvanceCredit');
    const { data: pendingPayments } = await supabase
      .from('maintenance_payments')
      .select('bill_id, maintenance_bills(id, amount)')
      .eq('user_id', user_id)
      .eq('building_id', building_id)
      .in('status', ['pending', 'partial'])
      .order('created_at', { ascending: true }); // oldest first

    if (pendingPayments?.length) {
      for (const p of pendingPayments) {
        const bill = p.maintenance_bills;
        if (bill) {
          await settleAdvanceCredit(building_id, [{ id: user_id }], { id: bill.id, amount: bill.amount });
        }
      }
    }
  } catch (err) {
    console.error('[phonepeCallback] Post-credit settlement error:', err.message);
  }

  return res.redirect(`mybuilding://advance-payment?status=success`);
    } else {
      return res.redirect(`mybuilding://advance-payment?status=failed`);
    }
  } catch (err) {
    console.error("PhonePe callback error:", err);
    return res.redirect(`mybuilding://advance-payment?status=failed`);
  }
};

// GET /maintenance/advance/summary
// Pramukh/admin only — all members with credit_balance and months_covered
exports.getAdvanceSummary = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });

  // Fetch latest bill amount for months_covered calculation
  const { data: latestBill } = await supabase
    .from('maintenance_bills')
    .select('amount')
    .eq('building_id', building_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const monthly_amount = latestBill?.amount ? Number(latestBill.amount) : null;

  // Fetch all credit balances for the building with user info
  const { data: credits, error } = await supabase
    .from('advance_credit_balance')
    .select('credit_balance, updated_at, users(id, name, flat_no, wing)')
    .eq('building_id', building_id)
    .gt('credit_balance', 0)
    .order('credit_balance', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });

  const summary = (credits || []).map((row) => ({
    user_id: row.users?.id,
    name: row.users?.name,
    flat_no: row.users?.flat_no,
    wing: row.users?.wing,
    credit_balance: Number(row.credit_balance),
    months_covered: monthly_amount && monthly_amount > 0
      ? Math.floor(Number(row.credit_balance) / monthly_amount)
      : 0,
    updated_at: row.updated_at,
  }));

  res.json({ summary, monthly_amount });
};
