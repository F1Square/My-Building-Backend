const supabase = require('../supabase');

const PINCODE_RE = /^\d{6}$/;
const VALID_SOCIETY_TYPES = ['Apartment Complex', 'Gated Community', 'Township', 'Co-operative Housing', 'Villa Society', 'Other'];
const VALID_PAYMENT_METHODS = ['Cash Only', 'Cheque', 'Online (Payment Gateway)', 'Both Cash & Online', 'Cheque & Online'];

// User: submit building inquiry
exports.submitInquiry = async (req, res) => {
  const {
    society_type, society_name, total_wings,
    state, city, pincode, address,
    late_fee, maintenance_fixed, water_bill_separate,
    payment_method, payment_gateway_link, society_logo, payment_tc,
    referral_code,
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
  if (payment_tc && payment_tc.length > 1000) return res.status(422).json({ error: 'Payment T&C must not exceed 1000 characters' });
  if (payment_method === 'Online (Payment Gateway)' && payment_gateway_link?.trim()) {
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
    payment_gateway_link: payment_method === 'Online (Payment Gateway)' ? payment_gateway_link?.trim() : null,
    society_logo: society_logo || null,
    payment_tc: payment_tc?.trim() || null,
    status: 'pending',
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });

  // Handle optional referral code
  if (referral_code?.trim()) {
    const { data: referrer } = await supabase
      .from('users')
      .select('id')
      .eq('referral_code', referral_code.trim().toUpperCase())
      .maybeSingle();

    if (!referrer) {
      return res.status(422).json({ error: 'Invalid referral code' });
    }
    if (referrer.id === req.user.id) {
      return res.status(422).json({ error: 'Self-referral is not permitted' });
    }

    // If a signup-time referral already exists for this (referrer, referee)
    // with no inquiry attached, attach the new inquiry/society to it
    // instead of creating a duplicate row.
    const { data: existing } = await supabase
      .from('referrals')
      .select('id')
      .eq('referrer_id', referrer.id)
      .eq('referee_email', req.user.email)
      .is('inquiry_id', null)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('referrals')
        .update({ inquiry_id: data.id, society_name: society_name.trim() })
        .eq('id', existing.id);
    } else {
      await supabase.from('referrals').insert({
        referrer_id: referrer.id,
        inquiry_id: data.id,
        referee_name: req.user.name,
        referee_email: req.user.email,
        society_name: society_name.trim(),
      });
    }
  }

  res.status(201).json({ message: 'Inquiry submitted', inquiry: data });
};

// PUBLIC: submit inquiry without auth (from website registration flow)
exports.submitPublicInquiry = async (req, res) => {
  const {
    user_name, user_email,
    society_type, society_name, total_wings,
    state, city, pincode, address,
    late_fee, maintenance_fixed, water_bill_separate,
    payment_method, payment_gateway_link, society_logo, payment_tc,
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
  if (payment_tc && payment_tc.length > 1000) return res.status(422).json({ error: 'Payment T&C must not exceed 1000 characters' });
  if (payment_method === 'Online (Payment Gateway)' && payment_gateway_link?.trim()) {
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
    payment_gateway_link: payment_method === 'Online (Payment Gateway)' ? payment_gateway_link?.trim() : null,
    society_logo: society_logo || null,
    payment_tc: payment_tc?.trim() || null,
    status: 'pending',
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'Society registration submitted! We will contact you soon.', inquiry: data });
};

// Admin: get all inquiries
exports.getInquiries = async (req, res) => {
  const { status, search } = req.query;
  let query = supabase.from('building_inquiries').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (search?.trim()) {
    const term = `%${search.trim()}%`;
    query = query.or(
      `society_name.ilike.${term},city.ilike.${term},state.ilike.${term},user_name.ilike.${term},user_email.ilike.${term}`
    );
  }
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

  if (status === 'approved') {
    const { data: inquiry } = await supabase
      .from('building_inquiries')
      .select('society_name, address, society_logo, payment_method, payment_tc')
      .eq('id', id)
      .single();

    if (inquiry) {
      const { v4: uuidv4 } = require('uuid');
      const building_id = uuidv4();
      await supabase.from('buildings').insert({
        id: building_id,
        name: inquiry.society_name,
        address: inquiry.address,
        society_logo: inquiry.society_logo ?? null,
        payment_method: inquiry.payment_method ?? null,
        payment_tc: inquiry.payment_tc ?? null,
      });
      await supabase.from('building_inquiries').update({ building_id }).eq('id', id);
    }
  }

  res.json({ message: 'Status updated', inquiry: data });
};
