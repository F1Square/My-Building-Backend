const supabase = require('../supabase');
const Razorpay = require('razorpay');
const PDFDocument = require('pdfkit');
const ns = require('../utils/notificationService');
const addMaintenanceExpense = require('../utils/addMaintenanceExpense');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Pramukh/Admin: add monthly maintenance bill
exports.addBill = async (req, res) => {
  const { amount, month, year, due_date, description, penalty_amount } = req.body;
  const building_id = req.user.building_id || req.body.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });
  if (!amount || !month || !year) return res.status(422).json({ error: 'amount, month and year are required' });

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) return res.status(422).json({ error: 'amount must be a positive number' });
  if (parsedAmount > 9999999) return res.status(422).json({ error: 'amount is too large' });

  const parsedMonth = parseInt(month);
  if (isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) return res.status(422).json({ error: 'month must be between 1 and 12' });

  const parsedYear = parseInt(year);
  if (isNaN(parsedYear) || parsedYear < 2000 || parsedYear > 2100) return res.status(422).json({ error: 'year must be a valid year' });

  if (due_date && isNaN(Date.parse(due_date))) return res.status(422).json({ error: 'due_date must be a valid date' });
  if (description && description.trim().length > 500) return res.status(422).json({ error: 'description must not exceed 500 characters' });

  const parsedPenalty = penalty_amount ? parseFloat(penalty_amount) : 0;
  if (isNaN(parsedPenalty) || parsedPenalty < 0) return res.status(422).json({ error: 'penalty_amount must be a non-negative number' });

  const { data: bill, error } = await supabase
    .from('maintenance_bills')
    .insert({
      building_id, amount: parsedAmount, month, year, due_date, description,
      penalty_amount: parsedPenalty,
      created_by: req.user.id
    })
    .select().single();

  if (error) return res.status(400).json({ error: error.message });

  const { data: members } = await supabase
    .from('users').select('id').eq('building_id', building_id).in('role', ['user', 'pramukh']).eq('status', 'approved');

  if (members?.length) {
    await supabase.from('maintenance_payments').insert(
      members.map((m) => ({
        bill_id: bill.id, user_id: m.id, building_id,
        amount: parsedAmount,
        penalty_amount: parsedPenalty,
        total_amount: parsedAmount, // penalty applied only after due date
        status: 'pending'
      }))
    );
    await ns.notifyMembers(building_id, {
      title: '🧾 Maintenance Bill',
      body: `New bill of ₹${parsedAmount} for ${MONTHS[month]} ${year}. Due: ${due_date || 'N/A'}${parsedPenalty > 0 ? `. Penalty: ₹${parsedPenalty} after due date` : ''}`,
      type: 'bill',
      meta: { bill_id: bill.id }
    });
  }

  res.status(201).json({ message: 'Bill added', bill });
};

// Pramukh/Admin: update an existing bill (penalty, description, due_date)
exports.updateBill = async (req, res) => {
  const { bill_id, penalty_amount, description, due_date } = req.body;
  if (!bill_id) return res.status(422).json({ error: 'bill_id is required' });

  const { data: bill } = await supabase.from('maintenance_bills').select('*').eq('id', bill_id).single();
  if (!bill) return res.status(404).json({ error: 'Bill not found' });

  // Pramukh can only edit their own building
  if (req.user.role === 'pramukh' && bill.building_id !== req.user.building_id)
    return res.status(403).json({ error: 'Access denied' });

  const updates = {};
  if (penalty_amount !== undefined) {
    const p = parseFloat(penalty_amount);
    if (isNaN(p) || p < 0) return res.status(422).json({ error: 'penalty_amount must be non-negative' });
    updates.penalty_amount = p;
  }
  if (description !== undefined) updates.description = description?.trim();
  if (due_date !== undefined) updates.due_date = due_date || null;

  // Only set is_edited/updated_at if we have something to update
  if (Object.keys(updates).length > 0) {
    updates.is_edited = true;
    updates.updated_at = new Date().toISOString();
  }

  const { data: updated, error } = await supabase
    .from('maintenance_bills').update(updates).eq('id', bill_id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Update pending payments' penalty_amount too
  if (penalty_amount !== undefined) {
    await supabase.from('maintenance_payments')
      .update({ penalty_amount: updates.penalty_amount })
      .eq('bill_id', bill_id)
      .eq('status', 'pending');
  }

  res.json({ message: 'Bill updated', bill: updated });
};

// Get all bills for a building
exports.getBills = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;

  let query = supabase.from('maintenance_bills').select('*');
  if (building_id) query = query.eq('building_id', building_id);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Get payment records (pramukh sees all in building, user sees own, admin sees all)
// Pass ?mine=true to always return only the current user's own records
exports.getPaymentRecords = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  const mineOnly = req.query.mine === 'true';

  let query = supabase
    .from('maintenance_payments')
    .select('*, maintenance_bills(month, year, amount, due_date, description), users!maintenance_payments_user_id_fkey(name, flat_no, email, phone)');

  if (building_id) {
    query = query.eq('building_id', building_id);
  }

  // Always filter to own records if: role is user, OR ?mine=true is passed
  if (req.user.role === 'user' || mineOnly) {
    query = query.eq('user_id', req.user.id);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// User/Pramukh: create Razorpay order + return checkout page URL (served by our backend)
exports.createPaymentOrder = async (req, res) => {
  const { payment_record_id } = req.body;
  if (!payment_record_id) return res.status(422).json({ error: 'payment_record_id is required' });

  // Fetch payment record with bill, user, and building info
  const { data: record, error: recErr } = await supabase
    .from('maintenance_payments')
    .select('*, maintenance_bills(amount, month, year, due_date, penalty_amount), users!maintenance_payments_user_id_fkey(name, flat_no, phone), buildings(name, address)')
    .eq('id', payment_record_id).eq('user_id', req.user.id).single();

  if (recErr || !record) return res.status(404).json({ error: 'Payment record not found' });
  if (record.status === 'paid') return res.status(400).json({ error: 'Already paid' });

  // Calculate total: apply penalty if past due date
  const billAmount = Number(record.maintenance_bills.amount);
  const penaltyAmount = Number(record.penalty_amount || record.maintenance_bills.penalty_amount || 0);
  const dueDate = record.maintenance_bills.due_date;
  const isOverdue = dueDate && new Date(dueDate) < new Date();
  const totalAmount = billAmount + (isOverdue && penaltyAmount > 0 ? penaltyAmount : 0);

  // Store total_amount on the payment record
  await supabase.from('maintenance_payments')
    .update({ total_amount: totalAmount, penalty_amount: isOverdue ? penaltyAmount : 0 })
    .eq('id', payment_record_id);

  try {
    const amountPaise = Math.round(totalAmount * 100);

    // Fetch society bank details for this building — used in notes for reconciliation
    const { data: bankDetails } = await supabase
      .from('building_bank_details')
      .select('bank_name, bank_account, bank_ifsc, bank_branch')
      .eq('building_id', record.building_id)
      .single();

    // Embed society + payer info in Razorpay notes for audit/reconciliation
    const notes = {
      society_name: record.buildings?.name || 'Unknown Society',
      society_account: bankDetails?.bank_account || 'Not configured',
      society_ifsc: bankDetails?.bank_ifsc || 'Not configured',
      society_bank: bankDetails?.bank_name || 'Not configured',
      payer_name: record.users?.name || '',
      payer_flat: record.users?.flat_no || '',
      payer_phone: record.users?.phone || '',
      bill_period: `${MONTHS[record.maintenance_bills.month]} ${record.maintenance_bills.year}`,
      bill_amount: billAmount,
      penalty_amount: isOverdue ? penaltyAmount : 0,
      total_amount: totalAmount,
      payment_record_id,
      building_id: record.building_id,
    };

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `maint_${payment_record_id.slice(0, 20)}`,
      notes,
    });

    await supabase.from('maintenance_payments')
      .update({ razorpay_order_id: order.id })
      .eq('id', payment_record_id);

    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) return res.status(500).json({ error: 'BACKEND_URL not set in .env' });

    const checkoutUrl = `${backendUrl}/api/maintenance/pay/checkout/${order.id}?record_id=${payment_record_id}&amount=${order.amount}&key=${process.env.RAZORPAY_KEY_ID}&society=${encodeURIComponent(record.buildings?.name || 'Society')}&penalty=${isOverdue && penaltyAmount > 0 ? penaltyAmount : 0}&bill=${billAmount}`;

    res.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID,
      checkout_url: checkoutUrl,
      payment_record_id,
      society_name: record.buildings?.name,
      bill_amount: billAmount,
      penalty_amount: isOverdue ? penaltyAmount : 0,
      total_amount: totalAmount,
      is_overdue: isOverdue && penaltyAmount > 0,
    });
  } catch (err) {
    console.error('Razorpay order error:', err);
    res.status(500).json({ error: 'Failed to create payment order: ' + (err.error?.description || err.message) });
  }
};

// Serve Razorpay checkout HTML page (opened in browser)
exports.checkoutPage = (req, res) => {
  const { order_id } = req.params;
  const { record_id, amount, key, society, penalty, bill } = req.query;
  const backendUrl = process.env.BACKEND_URL || '';
  const callbackUrl = `${backendUrl}/api/maintenance/pay/callback?record_id=${record_id}`;
  const societyName = decodeURIComponent(society || 'Society');
  const penaltyAmt = parseFloat(penalty || 0);
  const billAmt = parseFloat(bill || 0);
  const penaltyLine = penaltyAmt > 0
    ? `<div class="breakdown"><span>Bill</span><span>₹${billAmt.toLocaleString('en-IN')}</span></div><div class="breakdown penalty"><span>⚠️ Late Penalty</span><span>+₹${penaltyAmt.toLocaleString('en-IN')}</span></div>`
    : '';

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>My Building — Pay Maintenance</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #f5f7fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #fff; border-radius: 16px; padding: 32px 24px; max-width: 400px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); text-align: center; }
    .logo { font-size: 28px; font-weight: 800; color: #1E3A8A; margin-bottom: 4px; }
    .society { color: #1E3A8A; font-size: 15px; font-weight: 700; background: #EFF6FF; border-radius: 8px; padding: 6px 14px; display: inline-block; margin-bottom: 16px; }
    .subtitle { color: #6B7280; font-size: 14px; margin-bottom: 20px; }
    .amount { font-size: 36px; font-weight: 800; color: #111827; margin-bottom: 4px; }
    .label { font-size: 13px; color: #9CA3AF; margin-bottom: 28px; }
    .breakdown { display: flex; justify-content: space-between; font-size: 14px; color: #6B7280; margin-bottom: 4px; }
    .breakdown.penalty { color: #DC2626; font-weight: 600; }
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
    <div class="subtitle">Maintenance Payment</div>
    ${penaltyLine}
    <div class="amount">₹${Math.round(Number(amount) / 100).toLocaleString('en-IN')}</div>
    <div class="label">${penaltyAmt > 0 ? 'Total (includes late penalty)' : 'Tap below to pay securely via Razorpay'}</div>
    <button class="btn" id="payBtn" onclick="startPayment()">Pay Now</button>
    <div class="status" id="status"></div>
    <div class="secure">🔒 Secured by Razorpay · Payment ID logged for audit</div>
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
        description: "${societyName} — Maintenance",
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
              document.getElementById('status').textContent = '✅ Payment successful!';
              setTimeout(function() {
                window.location.href = 'mybuilding://payment?status=success&record_id=${record_id}';
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
            window.location.href = 'mybuilding://payment?status=cancelled&record_id=${record_id}';
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

const logActivity = require('../utils/activityLogger');

// Razorpay callback — called via fetch from the checkout page
exports.paymentCallback = async (req, res) => {
  const { record_id } = req.query;
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.json({ success: false, error: 'Missing payment data' });
  }

  const crypto = require('crypto');
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature) {
    // Log failed payment attempt
    const { data: rec } = await supabase
      .from('maintenance_payments')
      .select('user_id, building_id, amount, maintenance_bills(month, year), users(name, role)')
      .eq('id', record_id).single();
    if (rec) {
      await logActivity(
        { id: rec.user_id, name: rec.users?.name, role: rec.users?.role, building_id: rec.building_id },
        'payment_failed',
        'maintenance',
        { record_id, reason: 'signature_mismatch', amount: rec.amount, period: `${rec.maintenance_bills?.month}/${rec.maintenance_bills?.year}` }
      );
    }
    return res.json({ success: false, error: 'Signature mismatch' });
  }

  const { error } = await supabase.from('maintenance_payments').update({
    status: 'paid',
    razorpay_payment_id,
    paid_at: new Date().toISOString()
  }).eq('id', record_id);

  if (error) return res.json({ success: false, error: error.message });

  // Log successful payment
  const { data: rec } = await supabase
    .from('maintenance_payments')
    .select('user_id, building_id, amount, total_amount, maintenance_bills(month, year, amount), users(name, role)')
    .eq('id', record_id).single();
  if (rec) {
    await logActivity(
      { id: rec.user_id, name: rec.users?.name, role: rec.users?.role, building_id: rec.building_id },
      'payment_completed',
      'maintenance',
      {
        record_id,
        razorpay_payment_id,
        amount_paid: rec.total_amount || rec.amount,
        bill_period: `${rec.maintenance_bills?.month}/${rec.maintenance_bills?.year}`,
        method: 'online',
      }
    );
  }

  // Auto-add inflow to expenses module
  await addMaintenanceExpense(record_id);

  res.json({ success: true });
};

// User: verify payment
exports.verifyPayment = async (req, res) => {
  const { payment_record_id, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
  if (!payment_record_id || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature)
    return res.status(422).json({ error: 'payment_record_id, razorpay_payment_id, razorpay_order_id and razorpay_signature are required' });
  const crypto = require('crypto');

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature)
    return res.status(400).json({ error: 'Payment verification failed' });

  await supabase.from('maintenance_payments').update({
    status: 'paid', razorpay_payment_id, paid_at: new Date().toISOString()
  }).eq('id', payment_record_id);

  res.json({ message: 'Payment verified successfully' });
};

// Generate PDF receipt
exports.downloadReceipt = async (req, res) => {
  const { payment_record_id } = req.params;

  const { data: record } = await supabase
    .from('maintenance_payments')
    .select('*, maintenance_bills(month, year, amount, due_date, description), users!maintenance_payments_user_id_fkey(name, flat_no, email, phone), buildings(name, address)')
    .eq('id', payment_record_id).single();

  if (!record) return res.status(404).json({ error: 'Record not found' });
  if (record.status !== 'paid') return res.status(400).json({ error: 'Bill not paid yet' });
  // User can only download their own; pramukh/admin can download any
  if (req.user.role === 'user' && record.user_id !== req.user.id)
    return res.status(403).json({ error: 'Access denied' });

  const bill = record.maintenance_bills;
  const user = record.users;
  const building = record.buildings;

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=receipt_${payment_record_id.slice(0, 8)}.pdf`);
  doc.pipe(res);

  // Header band
  doc.rect(0, 0, doc.page.width, 80).fill('#1E3A8A');
  doc.fillColor('#fff').fontSize(26).font('Helvetica-Bold').text('My Building', 50, 22);
  doc.fontSize(11).font('Helvetica').text('Maintenance Payment Receipt', 50, 52);

  // Receipt meta box
  doc.fillColor('#111827').rect(50, 100, doc.page.width - 100, 55).stroke('#E5E7EB');
  doc.fontSize(10).font('Helvetica');
  doc.text(`Receipt No: ${payment_record_id.slice(0, 8).toUpperCase()}`, 62, 112);
  doc.text(`Payment Date: ${new Date(record.paid_at).toLocaleDateString('en-IN')}`, 62, 126);
  doc.text(`Method: Online (Razorpay)`, 300, 112);
  if (record.razorpay_payment_id) {
    doc.text(`Razorpay ID: ${record.razorpay_payment_id}`, 300, 126);
  }
  doc.fillColor('#16A34A').font('Helvetica-Bold').text('STATUS: PAID ✓', 62, 140);

  // Two-column info
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12).text('Building', 50, 175);
  doc.font('Helvetica').fontSize(10).fillColor('#374151');
  doc.text(building?.name || 'N/A', 50, 191);
  doc.text(building?.address || '', 50, 205);

  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12).text('Resident', 300, 175);
  doc.font('Helvetica').fontSize(10).fillColor('#374151');
  doc.text(`Name: ${user?.name}`, 300, 191);
  doc.text(`Flat: ${user?.flat_no || 'N/A'}  |  Phone: ${user?.phone || 'N/A'}`, 300, 205);

  // Table header
  doc.rect(50, 235, doc.page.width - 100, 26).fill('#F3F4F6');
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11);
  doc.text('Description', 62, 243);
  doc.text('Period', 240, 243);
  doc.text('Due Date', 360, 243);
  doc.text('Amount', 470, 243);

  // Table row
  doc.rect(50, 261, doc.page.width - 100, 32).stroke('#E5E7EB');
  doc.font('Helvetica').fontSize(10).fillColor('#374151');
  doc.text(bill?.description || 'Monthly Maintenance', 62, 271);
  doc.text(`${MONTHS[bill?.month]} ${bill?.year}`, 240, 271);
  doc.text(bill?.due_date || '—', 360, 271);
  doc.text(`Rs. ${Number(bill?.amount).toLocaleString('en-IN')}`, 470, 271);

  // Total row
  doc.rect(50, 308, doc.page.width - 100, 36).fill('#1E3A8A');
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(13);
  doc.text('Total Paid', 62, 319);
  doc.text(`Rs. ${Number(bill?.amount).toLocaleString('en-IN')}`, 470, 319);

  // Footer
  doc.fillColor('#9CA3AF').font('Helvetica').fontSize(9);
  doc.text('This is a computer-generated receipt. No signature required.', 50, 380, { align: 'center', width: doc.page.width - 100 });
  doc.text(`Generated on ${new Date().toLocaleString('en-IN')}`, 50, 393, { align: 'center', width: doc.page.width - 100 });

  doc.end();
};

// Pramukh/Admin: send payment reminder (with Expo push notification)
exports.sendReminder = async (req, res) => {
  const { user_id, bill_id } = req.body;
  const building_id = req.user.building_id || req.body.building_id;

  let query = supabase
    .from('maintenance_payments')
    .select('id, user_id, building_id, maintenance_bills(month, year, amount), users(name, expo_push_token)')
    .eq('status', 'pending');

  if (building_id) query = query.eq('building_id', building_id);
  if (bill_id) query = query.eq('bill_id', bill_id);
  if (user_id) query = query.eq('user_id', user_id);

  const { data: pending, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  if (!pending?.length) return res.json({ message: 'No pending payments found' });

  // Insert in-app notifications
  await supabase.from('notifications').insert(
    pending.map((p) => ({
      user_id: p.user_id,
      title: '⏰ Payment Reminder',
      body: `Please pay your maintenance of ₹${p.maintenance_bills?.amount} for ${MONTHS[p.maintenance_bills?.month]} ${p.maintenance_bills?.year}`,
      type: 'reminder',
      meta: { payment_record_id: p.id }
    }))
  );

  // Send Expo push notifications to users who have a push token
  const pushTokens = pending
    .map((p) => p.users?.expo_push_token)
    .filter(Boolean);

  if (pushTokens.length) {
    const messages = pushTokens.map((token) => ({
      to: token,
      sound: 'default',
      title: '⏰ Maintenance Reminder',
      body: `You have a pending maintenance payment. Please pay at your earliest.`,
      data: { type: 'reminder' },
    }));
    try {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
    } catch (pushErr) {
      console.error('Push notification error:', pushErr);
      // Don't fail the request if push fails
    }
  }

  res.json({ message: `Reminder sent to ${pending.length} member(s)` });
};
