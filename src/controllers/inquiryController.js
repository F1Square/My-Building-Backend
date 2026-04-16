const supabase = require('../supabase');

const PINCODE_RE = /^\d{6}$/;
const VALID_SOCIETY_TYPES = ['Apartment Complex', 'Gated Community', 'Township', 'Co-operative Housing', 'Villa Society', 'Other'];
const VALID_PAYMENT_METHODS = ['Cash', 'Cheque', 'Transaction Receipt', 'Payment Gateway', 'Cash & Cheque', 'All Methods'];

// User: submit building inquiry
exports.submitInquiry = async (req, res) => {
  const {
    society_type, society_name, total_wings,
    state, city, pincode, address,
    late_fee, maintenance_fixed, water_bill_separate,
    payment_method, payment_gateway_link, society_logo,
  } = req.body;

  if (!society_name?.trim()) return res.status(422).json({ error: 'Society name is required' });
  if (society_name.trim().length > 100) return res.status(422).json({ error: 'Society name must not exceed 100 characters' });
  if (!state?.trim() || !city?.trim()) return res.status(422).json({ error: 'State and city are required' });
  if (pincode && !PINCODE_RE.test(pincode.trim())) return res.status(422).json({ error: 'Pincode must be exactly 6 digits' });
  if (total_wings !== undefined && total_wings !== '') {
    const w = Number(total_wings);
    if (isNaN(w) || w < 1 || w > 100) return res.status(422).json({ error: 'Total wings must be between 1 and 100' });
  }
  if (late_fee !== undefined && late_fee !== '') {
    const f = Number(late_fee);
    if (isNaN(f) || f < 0) return res.status(422).json({ error: 'Late fee must be a non-negative number' });
  }
  if (payment_method === 'Payment Gateway' && payment_gateway_link?.trim()) {
    try { new URL(payment_gateway_link.trim()); } catch {
      return res.status(422).json({ error: 'Payment gateway link must be a valid URL' });
    }
  }

  const { data, error } = await supabase.from('building_inquiries').insert({
    user_id: req.user.id,
    user_name: req.user.name,
    user_email: req.user.email,
    society_type,
    society_name: society_name.trim(),
    total_wings: total_wings ? Number(total_wings) : null,
    state,
    city,
    pincode: pincode?.trim(),
    address: address?.trim(),
    late_fee: late_fee ? Number(late_fee) : null,
    maintenance_fixed: !!maintenance_fixed,
    water_bill_separate: !!water_bill_separate,
    payment_method,
    payment_gateway_link: payment_method === 'Payment Gateway' ? payment_gateway_link?.trim() : null,
    society_logo: society_logo || null,
    status: 'pending',
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'Inquiry submitted', inquiry: data });
};

// PUBLIC: submit inquiry without auth (from website registration flow)
exports.submitPublicInquiry = async (req, res) => {
  const {
    user_name, user_email,
    society_type, society_name, total_wings,
    state, city, pincode, address,
    late_fee, maintenance_fixed, water_bill_separate,
    payment_method, payment_gateway_link, society_logo,
  } = req.body;

  if (!user_name?.trim()) return res.status(422).json({ error: 'Your name is required' });
  if (!user_email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user_email.trim()))
    return res.status(422).json({ error: 'Valid email is required' });
  if (!society_name?.trim()) return res.status(422).json({ error: 'Society name is required' });
  if (!state?.trim() || !city?.trim()) return res.status(422).json({ error: 'State and city are required' });
  if (pincode && !PINCODE_RE.test(pincode.trim())) return res.status(422).json({ error: 'Pincode must be exactly 6 digits' });
  if (total_wings !== undefined && total_wings !== '') {
    const w = Number(total_wings);
    if (isNaN(w) || w < 1 || w > 100) return res.status(422).json({ error: 'Total wings must be between 1 and 100' });
  }
  if (payment_method === 'Payment Gateway' && payment_gateway_link?.trim()) {
    try { new URL(payment_gateway_link.trim()); } catch {
      return res.status(422).json({ error: 'Payment gateway link must be a valid URL' });
    }
  }

  const { data, error } = await supabase.from('building_inquiries').insert({
    user_id: null,
    user_name: user_name.trim(),
    user_email: user_email.trim().toLowerCase(),
    society_type,
    society_name: society_name.trim(),
    total_wings: total_wings ? Number(total_wings) : null,
    state,
    city,
    pincode: pincode?.trim(),
    address: address?.trim(),
    late_fee: late_fee ? Number(late_fee) : null,
    maintenance_fixed: !!maintenance_fixed,
    water_bill_separate: !!water_bill_separate,
    payment_method,
    payment_gateway_link: payment_method === 'Payment Gateway' ? payment_gateway_link?.trim() : null,
    society_logo: society_logo || null,
    status: 'pending',
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'Society registration submitted! We will contact you soon.', inquiry: data });
};

// Admin: get all inquiries
exports.getInquiries = async (req, res) => {
  const { status } = req.query;
  let query = supabase.from('building_inquiries').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Admin: update inquiry status
exports.updateInquiryStatus = async (req, res) => {
  const { id } = req.params;
  const { status, admin_note } = req.body;
  const VALID = ['pending', 'reviewed', 'approved', 'rejected'];
  if (!VALID.includes(status)) return res.status(422).json({ error: 'Invalid status' });

  const { data, error } = await supabase
    .from('building_inquiries')
    .update({ status, admin_note: admin_note?.trim(), reviewed_at: new Date().toISOString() })
    .eq('id', id).select().single();

  if (error || !data) return res.status(404).json({ error: 'Inquiry not found' });
  res.json({ message: 'Status updated', inquiry: data });
};
