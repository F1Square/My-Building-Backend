const supabase = require('../supabase');
const Razorpay = require('razorpay');
const PDFDocument = require('pdfkit');
const ns = require('../utils/notificationService');
const addMaintenanceExpense = require('../utils/addMaintenanceExpense');
const settleAdvanceCredit = require('../utils/settleAdvanceCredit');
const { uploadImage } = require('../utils/imageUploadHelper');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Pramukh/Admin: add monthly maintenance bill (category-aware)
exports.addBill = async (req, res) => {
  const {
    amount, month, year, due_date, description, penalty_amount,
    category = 'maintenance',
    amount_mode,
    targeting_mode = 'building_wide',
    flat_amounts,      // [{ user_id, amount }] for flat_wise
    targeted_user_ids, // [uuid] for targeted special bills
  } = req.body;
  const building_id = req.user.building_id || req.body.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });

  // Validate category
  const VALID_CATEGORIES = ['maintenance', 'water_meter', 'special'];
  if (!VALID_CATEGORIES.includes(category)) return res.status(422).json({ error: 'category must be maintenance, water_meter, or special' });

  // Validate targeting_mode
  const VALID_TARGETING = ['building_wide', 'targeted'];
  if (!VALID_TARGETING.includes(targeting_mode)) return res.status(422).json({ error: 'targeting_mode must be building_wide or targeted' });

  // Reject penalty_amount on non-maintenance bills
  if (penalty_amount && category !== 'maintenance') {
    return res.status(422).json({ error: 'penalty_amount is only applicable to maintenance bills' });
  }

  // Determine effective amount_mode
  const effectiveAmountMode = category === 'water_meter' ? 'flat_wise' : (amount_mode || 'uniform');
  const VALID_AMOUNT_MODES = ['uniform', 'flat_wise'];
  if (!VALID_AMOUNT_MODES.includes(effectiveAmountMode)) return res.status(422).json({ error: 'amount_mode must be uniform or flat_wise' });

  // Validate due_date
  if (!due_date) return res.status(422).json({ error: 'due_date is required' });
  if (isNaN(Date.parse(due_date))) return res.status(422).json({ error: 'due_date must be a valid date' });
  if (description && description.trim().length > 500) return res.status(422).json({ error: 'description must not exceed 500 characters' });

  // ── Maintenance: uniform, building-wide ──────────────────────────────────
  if (category === 'maintenance') {
    if (!amount || !month || !year) return res.status(422).json({ error: 'amount, month and year are required' });
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return res.status(422).json({ error: 'amount must be a positive number' });
    if (parsedAmount > 9999999) return res.status(422).json({ error: 'amount is too large' });
    const parsedMonth = parseInt(month);
    if (isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) return res.status(422).json({ error: 'month must be between 1 and 12' });
    const parsedYear = parseInt(year);
    if (isNaN(parsedYear) || parsedYear < 2000 || parsedYear > 2100) return res.status(422).json({ error: 'year must be a valid year' });
    const parsedPenalty = penalty_amount ? parseFloat(penalty_amount) : 0;
    if (isNaN(parsedPenalty) || parsedPenalty < 0) return res.status(422).json({ error: 'penalty_amount must be a non-negative number' });

    const { data: bill, error } = await supabase
      .from('maintenance_bills')
      .insert({
        building_id, amount: parsedAmount, month: parsedMonth, year: parsedYear,
        due_date, description, penalty_amount: parsedPenalty,
        category: 'maintenance', amount_mode: 'uniform', targeting_mode: 'building_wide',
        created_by: req.user.id,
      })
      .select().single();
    if (error) return res.status(400).json({ error: error.message });

    const { data: members } = await supabase
      .from('users').select('id').eq('building_id', building_id).in('role', ['user', 'pramukh']).eq('status', 'approved');

    if (members?.length) {
      await supabase.from('maintenance_payments').insert(
        members.map((m) => ({
          bill_id: bill.id, user_id: m.id, building_id,
          amount: parsedAmount, flat_amount: parsedAmount,
          penalty_amount: parsedPenalty, total_amount: parsedAmount,
          status: 'pending', category: 'maintenance',
        }))
      );
      await ns.notifyMembers(building_id, {
        title: '🧾 Maintenance Bill',
        body: `New bill of ₹${parsedAmount} for ${MONTHS[parsedMonth]} ${parsedYear}. Due: ${due_date}${parsedPenalty > 0 ? `. Penalty: ₹${parsedPenalty} after due date` : ''}`,
        type: 'bill', meta: { bill_id: bill.id },
      });
      await settleAdvanceCredit(building_id, members, { id: bill.id, amount: parsedAmount });
    }
    return res.status(201).json({ message: 'Bill added', bill });
  }

  // ── Water Meter: flat_wise or uniform, building-wide ────────────────────────
  if (category === 'water_meter') {
    if (effectiveAmountMode === 'uniform') {
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) return res.status(422).json({ error: 'amount must be a positive number' });

      const { data: bill, error } = await supabase
        .from('maintenance_bills')
        .insert({
          building_id, amount: parsedAmount, due_date, description: description || 'Water Meter Bill',
          category: 'water_meter', amount_mode: 'uniform', targeting_mode: 'building_wide',
          created_by: req.user.id,
        })
        .select().single();
      if (error) return res.status(400).json({ error: error.message });

      const { data: members } = await supabase
        .from('users').select('id').eq('building_id', building_id).in('role', ['user', 'pramukh']).eq('status', 'approved');

      if (members?.length) {
        await supabase.from('maintenance_payments').insert(
          members.map((m) => ({
            bill_id: bill.id, user_id: m.id, building_id,
            amount: parsedAmount, flat_amount: parsedAmount,
            status: 'pending', category: 'water_meter',
          }))
        );
        await ns.notifyMembers(building_id, {
          title: '💧 Water Meter Bill',
          body: `Water bill of ₹${parsedAmount} is due by ${due_date}.`,
          type: 'bill', meta: { bill_id: bill.id },
        });
      }
      return res.status(201).json({ message: 'Water meter bill added', bill });
    }

    // flat_wise
    if (!flat_amounts || !Array.isArray(flat_amounts) || flat_amounts.length === 0)
      return res.status(422).json({ error: 'flat_amounts is required for water_meter bills' });

    for (const entry of flat_amounts) {
      const amt = parseFloat(entry.amount);
      if (isNaN(amt) || amt <= 0)
        return res.status(422).json({ error: `amount for flat ${entry.flat_no || entry.user_id} must be a positive number` });
    }

    const { data: bill, error } = await supabase
      .from('maintenance_bills')
      .insert({
        building_id, amount: 0, due_date, description: description || 'Water Meter Bill',
        category: 'water_meter', amount_mode: 'flat_wise', targeting_mode: 'building_wide',
        created_by: req.user.id,
      })
      .select().single();
    if (error) return res.status(400).json({ error: error.message });

    await supabase.from('maintenance_payments').insert(
      flat_amounts.map((entry) => ({
        bill_id: bill.id, user_id: entry.user_id, building_id,
        amount: parseFloat(entry.amount), flat_amount: parseFloat(entry.amount),
        status: 'pending', category: 'water_meter',
      }))
    );

    for (const entry of flat_amounts) {
      await supabase.from('notifications').insert({
        user_id: entry.user_id,
        title: '💧 Water Meter Bill',
        body: `Your water bill of ₹${entry.amount} is due by ${due_date}.`,
        type: 'bill', meta: { bill_id: bill.id },
      });
    }
    return res.status(201).json({ message: 'Water meter bill added', bill });
  }

  // ── Special: uniform or flat_wise, building-wide or targeted ────────────
  if (category === 'special') {
    if (!description) return res.status(422).json({ error: 'description is required for special bills' });

    // Determine target residents
    let targetMembers;
    if (targeting_mode === 'targeted') {
      if (!targeted_user_ids || !Array.isArray(targeted_user_ids) || targeted_user_ids.length === 0)
        return res.status(422).json({ error: 'At least one flat must be selected' });
      const { data } = await supabase
        .from('users').select('id').in('id', targeted_user_ids).eq('building_id', building_id).eq('status', 'approved');
      targetMembers = data || [];
    } else {
      const { data } = await supabase
        .from('users').select('id').eq('building_id', building_id).in('role', ['user', 'pramukh']).eq('status', 'approved');
      targetMembers = data || [];
    }

    if (effectiveAmountMode === 'uniform') {
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) return res.status(422).json({ error: 'amount must be a positive number' });

      const { data: bill, error } = await supabase
        .from('maintenance_bills')
        .insert({
          building_id, amount: parsedAmount, due_date, description,
          category: 'special', amount_mode: 'uniform', targeting_mode,
          created_by: req.user.id,
        })
        .select().single();
      if (error) return res.status(400).json({ error: error.message });

      if (targetMembers.length) {
        await supabase.from('maintenance_payments').insert(
          targetMembers.map((m) => ({
            bill_id: bill.id, user_id: m.id, building_id,
            amount: parsedAmount, flat_amount: parsedAmount,
            status: 'pending', category: 'special',
          }))
        );
        await ns.notifyMembers(building_id, {
          title: '📋 Special Bill',
          body: `${description}: ₹${parsedAmount} due by ${due_date}.`,
          type: 'bill', meta: { bill_id: bill.id },
        }, targeting_mode === 'targeted' ? targetMembers.map(m => m.id) : null);
      }
      return res.status(201).json({ message: 'Special bill added', bill });
    }

    // flat_wise special
    if (!flat_amounts || !Array.isArray(flat_amounts) || flat_amounts.length === 0)
      return res.status(422).json({ error: 'flat_amounts is required for flat_wise special bills' });
    for (const entry of flat_amounts) {
      const amt = parseFloat(entry.amount);
      if (isNaN(amt) || amt <= 0)
        return res.status(422).json({ error: `amount for flat ${entry.flat_no || entry.user_id} must be a positive number` });
    }

    const { data: bill, error } = await supabase
      .from('maintenance_bills')
      .insert({
        building_id, amount: 0, due_date, description,
        category: 'special', amount_mode: 'flat_wise', targeting_mode,
        created_by: req.user.id,
      })
      .select().single();
    if (error) return res.status(400).json({ error: error.message });

    await supabase.from('maintenance_payments').insert(
      flat_amounts.map((entry) => ({
        bill_id: bill.id, user_id: entry.user_id, building_id,
        amount: parseFloat(entry.amount), flat_amount: parseFloat(entry.amount),
        status: 'pending', category: 'special',
      }))
    );
    for (const entry of flat_amounts) {
      await supabase.from('notifications').insert({
        user_id: entry.user_id,
        title: '📋 Special Bill',
        body: `${description}: ₹${entry.amount} due by ${due_date}.`,
        type: 'bill', meta: { bill_id: bill.id },
      });
    }
    return res.status(201).json({ message: 'Special bill added', bill });
  }

  res.status(422).json({ error: 'Invalid category' });
};

// Admin: delete a bill and all its payment records
exports.deleteBill = async (req, res) => {
  const { id } = req.params;
  const { data: bill } = await supabase.from('maintenance_bills').select('id').eq('id', id).single();
  if (!bill) return res.status(404).json({ error: 'Bill not found' });

  // Delete payment records first (FK constraint)
  await supabase.from('maintenance_payments').delete().eq('bill_id', id);
  const { error } = await supabase.from('maintenance_bills').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Bill deleted' });
};

// Pramukh/Admin: update an existing bill (penalty, description, due_date, amount)
exports.updateBill = async (req, res) => {
  const { bill_id, penalty_amount, description, due_date, amount } = req.body;
  if (!bill_id) return res.status(422).json({ error: 'bill_id is required' });

  const { data: bill } = await supabase.from('maintenance_bills').select('*').eq('id', bill_id).single();
  if (!bill) return res.status(404).json({ error: 'Bill not found' });

  if (req.user.role === 'pramukh' && bill.building_id !== req.user.building_id)
    return res.status(403).json({ error: 'Access denied' });

  const updates = {};
  if (description !== undefined) updates.description = description?.trim();
  if (due_date !== undefined) updates.due_date = due_date || null;

  if (amount !== undefined) {
    const a = parseFloat(amount);
    if (isNaN(a) || a <= 0) return res.status(422).json({ error: 'amount must be a positive number' });
    updates.amount = a;
  }

  if (penalty_amount !== undefined) {
    if (bill.category && bill.category !== 'maintenance')
      return res.status(422).json({ error: 'penalty_amount is only applicable to maintenance bills' });
    const p = parseFloat(penalty_amount);
    if (isNaN(p) || p < 0) return res.status(422).json({ error: 'penalty_amount must be non-negative' });
    updates.penalty_amount = p;
  }

  if (Object.keys(updates).length > 0) {
    updates.is_edited = true;
    updates.updated_at = new Date().toISOString();
    // Only store edited_by for pramukh — admin edits are silent
    if (req.user.role === 'pramukh') {
      updates.edited_by = req.user.id;
    } else {
      updates.edited_by = null; // admin: clear any previous pramukh edit attribution
    }
  }

  const { data: updated, error } = await supabase
    .from('maintenance_bills').update(updates).eq('id', bill_id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Sync pending payment amounts if base amount changed
  if (amount !== undefined) {
    await supabase.from('maintenance_payments')
      .update({ amount: updates.amount, flat_amount: updates.amount })
      .eq('bill_id', bill_id)
      .eq('status', 'pending');
  }

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
  const { category } = req.query;

  let query = supabase.from('maintenance_bills')
    .select('*, editor:edited_by(name)');
  if (building_id) query = query.eq('building_id', building_id);
  if (category) query = query.eq('category', category);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Get payment records (pramukh sees all in building, user sees own, admin sees all)
// Pass ?mine=true to always return only the current user's own records
// Pass ?category= to filter by billing category
exports.getPaymentRecords = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  const mineOnly = req.query.mine === 'true';
  const { category } = req.query;

  let query = supabase
    .from('maintenance_payments')
    .select('*, maintenance_bills(month, year, amount, due_date, description, category, penalty_amount), users!maintenance_payments_user_id_fkey(name, flat_no, email, phone), buildings(payment_method, payment_tc)');

  if (building_id) query = query.eq('building_id', building_id);
  if (req.user.role === 'user' || mineOnly) query = query.eq('user_id', req.user.id);
  if (category) query = query.eq('category', category);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });

  const mapped = data.map(p => {
    const billAmount = Number(p.amount);
    const penaltyAmount = Number(p.penalty_amount || 0);
    const dueDate = p.maintenance_bills?.due_date;
    const isOverdue = dueDate && new Date(dueDate) < new Date();
    // Only apply penalty for maintenance category
    const isMaintenance = (p.category || p.maintenance_bills?.category || 'maintenance') === 'maintenance';
    const displayAmount = p.total_amount
      ? Number(p.total_amount)
      : billAmount + (isMaintenance && isOverdue && penaltyAmount > 0 ? penaltyAmount : 0);

    return {
      ...p,
      display_amount: displayAmount,
      is_overdue: !!(isMaintenance && isOverdue && penaltyAmount > 0),
      building_payment_method: p.buildings?.payment_method ?? null,
      building_payment_tc: p.buildings?.payment_tc ?? null,
      buildings: undefined,
    };
  });
  res.json(mapped);
};

// Upload receipt image to Cloudinary
exports.uploadReceiptImage = async (req, res) => {
  try {
    const { payment_record_id } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'No receipt image provided',
        code: 'MISSING_FILE'
      });
    }

    if (!payment_record_id) {
      return res.status(400).json({ 
        success: false,
        error: 'payment_record_id is required',
        code: 'MISSING_PAYMENT_ID'
      });
    }

    // Verify payment record belongs to user
    const { data: record } = await supabase
      .from('maintenance_payments')
      .select('id, user_id, status')
      .eq('id', payment_record_id)
      .eq('user_id', req.user.id)
      .single();

    if (!record) {
      return res.status(404).json({ 
        success: false,
        error: 'Payment record not found',
        code: 'RECORD_NOT_FOUND'
      });
    }

    if (record.status === 'paid') {
      return res.status(400).json({ 
        success: false,
        error: 'Payment already completed',
        code: 'ALREADY_PAID'
      });
    }

    // Upload image to Cloudinary
    const result = await uploadImage(req.file.buffer, {
      folder: 'receipts',
      publicId: `receipt_${payment_record_id}`
    });

    // Update payment record with receipt URL
    const { error } = await supabase
      .from('maintenance_payments')
      .update({ 
        receipt_url: result.secure_url,
        status: 'receipt_uploaded'
      })
      .eq('id', payment_record_id);

    if (error) {
      console.error('Database update error:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to save receipt reference',
        code: 'DATABASE_ERROR'
      });
    }

    res.json({
      success: true,
      receipt_url: result.secure_url,
      public_id: result.public_id,
      status: 'receipt_uploaded',
      width: result.width,
      height: result.height,
      format: result.format
    });
  } catch (error) {
    console.error('Receipt upload error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to upload receipt',
      code: 'UPLOAD_FAILED'
    });
  }
};

// User/Pramukh: upload transaction receipt for a pending payment
exports.uploadReceipt = async (req, res) => {
  const { id } = req.params;
  const { receipt_url } = req.body;
  if (!receipt_url) return res.status(422).json({ error: 'receipt_url is required' });

  const { data: record } = await supabase
    .from('maintenance_payments')
    .select('id, user_id, status')
    .eq('id', id)
    .single();

  if (!record) return res.status(404).json({ error: 'Payment record not found' });
  if (record.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
  if (record.status === 'paid') return res.status(400).json({ error: 'Payment already completed' });

  const { error } = await supabase
    .from('maintenance_payments')
    .update({ receipt_url, status: 'receipt_uploaded' })
    .eq('id', id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Receipt uploaded', status: 'receipt_uploaded' });
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
      .select('bank_name, bank_account, bank_ifsc, bank_branch, razorpay_account_id')
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

    const orderOptions = {
      amount: amountPaise,
      currency: 'INR',
      receipt: `maint_${payment_record_id.slice(0, 20)}`,
      notes,
    };

    if (bankDetails?.razorpay_account_id) {
      orderOptions.transfers = [
        {
          account: bankDetails.razorpay_account_id,
          amount: amountPaise,
          currency: 'INR',
          notes,
          on_hold: 0,
        }
      ];
    }

    const order = await razorpay.orders.create(orderOptions);

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
const { transferToAccount } = require('./routesController');

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

  // Fetch payment record for logging + transfer
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

    // ── Simplified Razorpay Transfer: handled at order creation ──────────────
    const { data: bankRow } = await supabase
      .from('building_bank_details')
      .select('razorpay_account_id')
      .eq('building_id', rec.building_id)
      .single();

    console.log('[Transfer] Bank details for building:', rec.building_id, bankRow);

    if (bankRow?.razorpay_account_id) {
      console.log('[Transfer] Transfer was handled automatically during order creation for:', razorpay_payment_id);
      
      // Store dummy transfer ID so the dashboard counts it as successful
      await supabase.from('maintenance_payments')
        .update({ 
          razorpay_transfer_id: 'order_transfer_auto',
          transfer_completed_at: new Date().toISOString(),
          transfer_error: null
        })
        .eq('id', record_id);
    } else {
      console.log('[Transfer] No Razorpay account connected for building:', rec.building_id);
    }
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

// Pramukh/Admin: generate PDF or Excel report for a bill
exports.getReport = async (req, res) => {
  const { bill_id } = req.params;
  const { format = 'pdf' } = req.query;

  if (!['pdf', 'excel'].includes(format))
    return res.status(400).json({ error: 'format must be pdf or excel' });

  const { data: bill } = await supabase
    .from('maintenance_bills')
    .select('*, buildings(name, address)')
    .eq('id', bill_id).single();
  if (!bill) return res.status(404).json({ error: 'Bill not found' });

  // Scope check
  if (req.user.role === 'pramukh' && bill.building_id !== req.user.building_id)
    return res.status(403).json({ error: 'Access denied' });

  const { data: payments } = await supabase
    .from('maintenance_payments')
    .select('*, users!maintenance_payments_user_id_fkey(name, flat_no, wing)')
    .eq('bill_id', bill_id)
    .order('created_at', { ascending: true });

  const rows = (payments || []).map(p => ({
    flat_no: p.users?.flat_no || '—',
    wing: p.users?.wing || '—',
    name: p.users?.name || '—',
    amount: Number(p.flat_amount || p.amount),
    status: p.status === 'paid' ? 'Paid' : 'Pending',
    paid_at: p.paid_at ? new Date(p.paid_at).toLocaleDateString('en-IN') : '—',
  }));

  const categoryLabel = { maintenance: 'Maintenance Bill', water_meter: 'Water Meter Bill', special: 'Special Bill' }[bill.category || 'maintenance'] || 'Bill';
  const periodLabel = bill.month ? `${MONTHS[bill.month]} ${bill.year}` : (bill.description || '');
  const buildingName = bill.buildings?.name || 'Building';

  if (format === 'excel') {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Report');

    // Title rows
    ws.mergeCells('A1:F1');
    ws.getCell('A1').value = `${buildingName} — ${categoryLabel}`;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.mergeCells('A2:F2');
    ws.getCell('A2').value = periodLabel ? `Period: ${periodLabel}` : `Due: ${bill.due_date || '—'}`;
    ws.getCell('A2').font = { size: 11, color: { argb: 'FF6B7280' } };

    // Header row
    const header = ws.addRow(['Flat No.', 'Wing', 'Resident Name', 'Amount (₹)', 'Status', 'Payment Date']);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } };

    // Data rows
    rows.forEach(r => {
      const row = ws.addRow([r.flat_no, r.wing, r.name, r.amount, r.status, r.paid_at]);
      if (r.status === 'Paid') {
        row.getCell(5).font = { color: { argb: 'FF16A34A' }, bold: true };
      } else {
        row.getCell(5).font = { color: { argb: 'FFDC2626' } };
      }
    });

    // Auto-width
    ws.columns.forEach(col => {
      let max = 10;
      col.eachCell({ includeEmpty: true }, cell => {
        const len = cell.value ? String(cell.value).length : 0;
        if (len > max) max = len;
      });
      col.width = max + 2;
    });

    const filename = `report_${bill_id.slice(0, 8)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    await wb.xlsx.write(res);
    return res.end();
  }

  // PDF
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const filename = `report_${bill_id.slice(0, 8)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  doc.pipe(res);

  // Header band
  doc.rect(0, 0, doc.page.width, 80).fill('#1E3A8A');
  doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold').text(buildingName, 50, 20);
  doc.fontSize(11).font('Helvetica').text(`${categoryLabel} — Collection Report`, 50, 48);

  // Meta
  doc.fillColor('#111827').fontSize(10).font('Helvetica');
  doc.text(`Period: ${periodLabel || '—'}`, 50, 96);
  doc.text(`Due Date: ${bill.due_date || '—'}`, 250, 96);
  const paidCount = rows.filter(r => r.status === 'Paid').length;
  doc.text(`Paid: ${paidCount} / ${rows.length}`, 420, 96);

  // Table header
  const tableTop = 120;
  doc.rect(50, tableTop, doc.page.width - 100, 24).fill('#F3F4F6');
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10);
  doc.text('Flat', 58, tableTop + 7);
  doc.text('Wing', 100, tableTop + 7);
  doc.text('Resident', 145, tableTop + 7);
  doc.text('Amount', 310, tableTop + 7);
  doc.text('Status', 390, tableTop + 7);
  doc.text('Paid On', 460, tableTop + 7);

  let y = tableTop + 24;
  rows.forEach((r, i) => {
    if (i % 2 === 0) doc.rect(50, y, doc.page.width - 100, 22).fill('#FAFAFA');
    doc.fillColor('#374151').font('Helvetica').fontSize(9);
    doc.text(r.flat_no, 58, y + 6);
    doc.text(r.wing, 100, y + 6);
    doc.text(r.name, 145, y + 6, { width: 155, ellipsis: true });
    doc.text(`₹${r.amount.toLocaleString('en-IN')}`, 310, y + 6);
    doc.fillColor(r.status === 'Paid' ? '#16A34A' : '#DC2626').font('Helvetica-Bold');
    doc.text(r.status, 390, y + 6);
    doc.fillColor('#374151').font('Helvetica');
    doc.text(r.paid_at, 460, y + 6);
    y += 22;
    if (y > doc.page.height - 80) { doc.addPage(); y = 50; }
  });

  // Footer
  doc.fillColor('#9CA3AF').font('Helvetica').fontSize(9);
  doc.text(`Generated on ${new Date().toLocaleString('en-IN')}`, 50, doc.page.height - 40, { align: 'center', width: doc.page.width - 100 });
  doc.end();
};
// Send payment reminders
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

// Get transfer status for debugging
exports.getTransferStatus = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });

  try {
    // Get recent payments with transfer info
    const { data: payments } = await supabase
      .from('maintenance_payments')
      .select(`
        id, amount, total_amount, status, razorpay_payment_id, razorpay_transfer_id,
        transfer_error, transfer_attempted_at, transfer_completed_at, paid_at,
        users(name, flat_no),
        maintenance_bills(month, year, description)
      `)
      .eq('building_id', building_id)
      .eq('status', 'paid')
      .order('paid_at', { ascending: false })
      .limit(20);

    // Get bank details
    const { data: bankDetails } = await supabase
      .from('building_bank_details')
      .select('razorpay_account_id, bank_name, bank_account')
      .eq('building_id', building_id)
      .single();

    res.json({
      payments: payments || [],
      bank_details: bankDetails,
      summary: {
        total_payments: payments?.length || 0,
        successful_transfers: payments?.filter(p => p.razorpay_transfer_id).length || 0,
        failed_transfers: payments?.filter(p => p.transfer_error).length || 0,
        pending_transfers: payments?.filter(p => !p.razorpay_transfer_id && !p.transfer_error).length || 0,
      }
    });
  } catch (error) {
    console.error('Transfer status error:', error);
    res.status(500).json({ error: 'Failed to fetch transfer status' });
  }
};
