const supabase = require('../supabase');
const {
  validateReferralForInquiry,
  applyReferralToInquiry,
  ReferralValidationError,
} = require('../utils/referralHelper');
const { userDisplayName } = require('../utils/userDisplayName');
const {
  normalizePaymentMethods,
  validateSocietyInquiryFields,
} = require('../utils/societyInquiryValidation');
const { notifyOpsSocietyInquiry } = require('../utils/mailService');

function buildInquiryRow({
  user_id,
  user_name,
  user_email,
  user_phone,
  body,
  paymentMethodValue,
}) {
  const {
    society_type,
    society_name,
    total_wings,
    state,
    city,
    pincode,
    address,
    late_fee,
    maintenance_fixed,
    water_bill_separate,
    society_logo,
    payment_tc,
  } = body;

  return {
    user_id,
    user_name,
    user_email,
    user_phone: String(user_phone || '').trim(),
    society_type,
    society_name: society_name.trim(),
    total_wings: Number(total_wings),
    state: state.trim(),
    city: city.trim(),
    pincode: pincode.trim(),
    address: address.trim(),
    late_fee: late_fee !== undefined && late_fee !== null && late_fee !== '' ? Number(late_fee) : null,
    maintenance_fixed: !!maintenance_fixed,
    water_bill_separate: !!water_bill_separate,
    payment_method: paymentMethodValue,
    payment_gateway_link: null,
    society_logo: society_logo || null,
    payment_tc: payment_tc?.trim() || null,
    status: 'pending',
  };
}

// PUBLIC: validate an optional referral before the user continues registration.
// Final submission validates it again with the society name, so this is only an early UX check.
exports.validatePublicReferral = async (req, res) => {
  const { referral_code, user_email } = req.body;
  const normalizedEmail = user_email?.trim().toLowerCase();

  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(422).json({ error: 'Valid email is required' });
  }
  if (!referral_code?.trim()) {
    return res.status(422).json({ error: 'Referral code is required' });
  }

  try {
    await validateReferralForInquiry({
      referralCode: referral_code,
      refereeEmail: normalizedEmail,
      societyName: '',
    });
    return res.json({ valid: true });
  } catch (err) {
    if (err instanceof ReferralValidationError) {
      return res.status(err.statusCode).json({ valid: false, error: err.message });
    }
    throw err;
  }
};

// User: submit building inquiry (authenticated)
exports.submitInquiry = async (req, res) => {
  const body = req.body;
  const fieldError = validateSocietyInquiryFields(body, { requireLogo: true });
  if (fieldError) return res.status(422).json({ error: fieldError });

  const payment = normalizePaymentMethods(body);
  if (!payment.ok) return res.status(422).json({ error: payment.error });

  try {
    await validateReferralForInquiry({
      referralCode: body.referral_code,
      refereeUserId: req.user.id,
      refereeEmail: req.user.email,
      societyName: body.society_name,
    });
  } catch (err) {
    if (err instanceof ReferralValidationError) return res.status(err.statusCode).json({ error: err.message });
    throw err;
  }

  const displayName = userDisplayName(req.user);
  const { data, error } = await supabase.from('building_inquiries').insert(
    buildInquiryRow({
      user_id: req.user.id,
      user_name: displayName,
      user_email: req.user.email,
      user_phone: body.user_phone,
      body,
      paymentMethodValue: payment.value,
    }),
  ).select().single();

  if (error) return res.status(400).json({ error: error.message });

  if (body.referral_code?.trim()) {
    try {
      await applyReferralToInquiry({
        referralCode: body.referral_code,
        refereeUserId: req.user.id,
        refereeEmail: req.user.email,
        refereeName: displayName,
        inquiryId: data.id,
        societyName: body.society_name.trim(),
      });
    } catch (err) {
      await supabase.from('building_inquiries').delete().eq('id', data.id);
      if (err instanceof ReferralValidationError) return res.status(err.statusCode).json({ error: err.message });
      return res.status(400).json({ error: err.message });
    }
  }

  // Best-effort ops email — do not fail the inquiry if mail fails
  await notifyOpsSocietyInquiry(data, 'App (register building)');

  res.status(201).json({ message: 'Inquiry submitted', inquiry: data });
};

// PUBLIC: submit inquiry without auth (from website registration flow)
exports.submitPublicInquiry = async (req, res) => {
  const body = req.body;
  const { user_name, user_email, society_name, referral_code } = body;

  if (!user_name?.trim()) return res.status(422).json({ error: 'Your name is required' });
  if (!user_email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user_email.trim())) {
    return res.status(422).json({ error: 'Valid email is required' });
  }

  const fieldError = validateSocietyInquiryFields(body, { requireLogo: true });
  if (fieldError) return res.status(422).json({ error: fieldError });

  const payment = normalizePaymentMethods(body);
  if (!payment.ok) return res.status(422).json({ error: payment.error });

  const normalizedEmail = user_email.trim().toLowerCase();

  try {
    await validateReferralForInquiry({
      referralCode: referral_code,
      refereeEmail: normalizedEmail,
      societyName: society_name,
    });
  } catch (err) {
    if (err instanceof ReferralValidationError) return res.status(err.statusCode).json({ error: err.message });
    throw err;
  }

  const displayName = userDisplayName({ name: user_name, email: normalizedEmail });
  const { data, error } = await supabase.from('building_inquiries').insert(
    buildInquiryRow({
      user_id: null,
      user_name: displayName,
      user_email: normalizedEmail,
      user_phone: body.user_phone,
      body,
      paymentMethodValue: payment.value,
    }),
  ).select().single();

  if (error) return res.status(400).json({ error: error.message });

  if (referral_code?.trim()) {
    try {
      await applyReferralToInquiry({
        referralCode: referral_code,
        refereeEmail: normalizedEmail,
        refereeName: displayName,
        inquiryId: data.id,
        societyName: society_name.trim(),
      });
    } catch (err) {
      await supabase.from('building_inquiries').delete().eq('id', data.id);
      if (err instanceof ReferralValidationError) return res.status(err.statusCode).json({ error: err.message });
      return res.status(400).json({ error: err.message });
    }
  }

  // Best-effort ops email — do not fail the inquiry if mail fails
  await notifyOpsSocietyInquiry(data, 'Website (register society)');

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
      `society_name.ilike.${term},city.ilike.${term},state.ilike.${term},user_name.ilike.${term},user_email.ilike.${term},user_phone.ilike.${term}`
    );
  }
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json((data || []).map((row) => ({
    ...row,
    user_name: userDisplayName({ name: row.user_name, email: row.user_email }),
  })));
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
