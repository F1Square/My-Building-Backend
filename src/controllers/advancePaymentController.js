const crypto = require('crypto');
const supabase = require('../supabase');
const Razorpay = require('razorpay');
const ns = require('../utils/notificationService');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

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
    const amountPaise = Math.round(total_amount * 100);
    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `adv_${user_id.slice(0, 16)}`,
      notes: {
        type: 'advance_maintenance',
        member_name: userRow?.name || '',
        member_flat: userRow?.flat_no || '',
        member_phone: userRow?.phone || '',
        building_name: buildingRow?.name || '',
        advance_months: months,
        monthly_amount,
        total_amount,
        building_id,
        user_id,
      },
    });

    // Insert pending order row
    const { data: orderRow, error: insertErr } = await supabase
      .from('advance_payment_orders')
      .insert({
        user_id,
        building_id,
        months: Number(months),
        monthly_amount,
        total_amount,
        status: 'pending',
        razorpay_order_id: order.id,
      })
      .select()
      .single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) return res.status(500).json({ error: 'BACKEND_URL not set in .env' });

    const checkoutUrl = `${backendUrl}/api/maintenance/advance/checkout/${order.id}?order_row_id=${orderRow.id}&amount=${order.amount}&key=${process.env.RAZORPAY_KEY_ID}&society=${encodeURIComponent(buildingRow?.name || 'Society')}&months=${months}&monthly=${monthly_amount}`;

    res.json({ order_id: order.id, checkout_url: checkoutUrl, total_amount, monthly_amount, months });
  } catch (err) {
    console.error('Razorpay advance order error:', err);
    res.status(500).json({ error: 'Failed to create payment order: ' + (err.error?.description || err.message) });
  }
};

// GET /maintenance/advance/checkout/:order_id
// Serves HTML checkout page — no auth (opened in browser)
exports.advancePaymentCheckout = (req, res) => {
  const { order_id } = req.params;
  const { order_row_id, amount, key, society, months, monthly } = req.query;
  const backendUrl = process.env.BACKEND_URL || '';
  const callbackUrl = `${backendUrl}/api/maintenance/advance/callback?order_row_id=${order_row_id}`;
  const societyName = decodeURIComponent(society || 'Society');
  const numMonths = parseInt(months || '1');
  const monthlyAmt = parseFloat(monthly || '0');
  const totalAmt = Math.round(Number(amount) / 100);

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>My Building — Advance Payment</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #f5f7fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #fff; border-radius: 16px; padding: 32px 24px; max-width: 400px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); text-align: center; }
    .logo { font-size: 28px; font-weight: 800; color: #1E3A8A; margin-bottom: 4px; }
    .society { color: #1E3A8A; font-size: 15px; font-weight: 700; background: #EFF6FF; border-radius: 8px; padding: 6px 14px; display: inline-block; margin-bottom: 16px; }
    .subtitle { color: #6B7280; font-size: 14px; margin-bottom: 20px; }
    .advance-badge { background: #F0FDF4; border: 1px solid #86EFAC; border-radius: 8px; padding: 8px 16px; display: inline-block; margin-bottom: 16px; }
    .advance-badge-text { color: #16A34A; font-size: 13px; font-weight: 700; }
    .breakdown { display: flex; justify-content: space-between; font-size: 14px; color: #6B7280; margin-bottom: 6px; }
    .amount { font-size: 36px; font-weight: 800; color: #111827; margin: 12px 0 4px; }
    .label { font-size: 13px; color: #9CA3AF; margin-bottom: 28px; }
    .btn { background: #1E3A8A; color: #fff; border: none; border-radius: 12px; padding: 16px 32px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; }
    .btn:disabled { opacity: 0.6; }
    .status { margin-top: 20px; font-size: 14px; color: #6B7280; }
    .secure { font-size: 12px; color: #9CA3AF; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🏢 My Building</div>
    <div class="society">${societyName}</div>
    <div class="subtitle">Advance Maintenance Payment</div>
    <div class="advance-badge">
      <span class="advance-badge-text">📅 ${numMonths} Month${numMonths > 1 ? 's' : ''} in Advance</span>
    </div>
    <div class="breakdown"><span>Monthly Amount</span><span>₹${monthlyAmt.toLocaleString('en-IN')}</span></div>
    <div class="breakdown"><span>Months</span><span>× ${numMonths}</span></div>
    <div class="amount">₹${totalAmt.toLocaleString('en-IN')}</div>
    <div class="label">Total advance payment</div>
    <button class="btn" id="payBtn" onclick="startPayment()">Pay Now</button>
    <div class="status" id="status"></div>
    <div class="secure">🔒 Secured by Razorpay · Credit applied automatically when bills are generated</div>
  </div>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <script>
    function startPayment() {
      var btn = document.getElementById('payBtn');
      btn.disabled = true;
      btn.textContent = 'Opening payment...';
      var options = {
        key: "${key}",
        amount: ${amount},
        currency: "INR",
        order_id: "${order_id}",
        name: "My Building",
        description: "${societyName} — ${numMonths} Month Advance",
        theme: { color: "#1E3A8A" },
        config: {
          display: {
            blocks: {
              upi: { name: "Pay via UPI", instruments: [{ method: "upi" }] },
              other: { name: "Other Methods", instruments: [{ method: "card" }, { method: "netbanking" }, { method: "wallet" }] }
            },
            sequence: ["block.upi", "block.other"],
            preferences: { show_default_blocks: true }
          }
        },
        handler: function(response) {
          document.getElementById('status').textContent = 'Verifying payment...';
          fetch('${callbackUrl}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature
            })
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.success) {
              document.getElementById('status').textContent = '✅ Payment successful! Credit added to your account.';
              setTimeout(function() {
                window.location.href = 'mybuilding://advance-payment?status=success';
              }, 1500);
            } else {
              document.getElementById('status').textContent = '❌ Verification failed. Contact support.';
              btn.disabled = false;
              btn.textContent = 'Retry';
            }
          })
          .catch(function() {
            document.getElementById('status').textContent = '❌ Network error during verification.';
            btn.disabled = false;
            btn.textContent = 'Retry';
          });
        },
        modal: {
          ondismiss: function() {
            btn.disabled = false;
            btn.textContent = 'Pay Now';
            window.location.href = 'mybuilding://advance-payment?status=cancelled';
          }
        }
      };
      var rzp = new Razorpay(options);
      rzp.on('payment.failed', function(response) {
        document.getElementById('status').textContent = '❌ ' + (response.error.description || 'Payment failed');
        btn.disabled = false;
        btn.textContent = 'Try Again';
      });
      rzp.open();
    }
    window.onload = function() { startPayment(); };
  </script>
</body>
</html>`);
};

// POST /maintenance/advance/callback
// Verifies Razorpay signature, credits balance, inserts ledger row (idempotent)
exports.advancePaymentCallback = async (req, res) => {
  const { order_row_id } = req.query;
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.json({ success: false, error: 'Missing payment data' });
  }

  // Verify HMAC-SHA256 signature
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature) {
    return res.json({ success: false, error: 'Signature mismatch' });
  }

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
    console.error('[advancePaymentCallback] Post-credit settlement error:', err.message);
  }

  res.json({ success: true });
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
