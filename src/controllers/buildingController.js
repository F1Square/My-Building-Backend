const supabase = require('../supabase');
const { v4: uuidv4 } = require('uuid');
const ns = require('../utils/notificationService');
const { createCopy } = require('../utils/notificationCopy');
const { userDisplayName, withDisplayUser, mapRowsWithDisplayUsers } = require('../utils/userDisplayName');
const { normalizeBankWing } = require('../utils/validators');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[6-9]\d{9}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const BUILDING_CODE_RE = /^[A-Za-z0-9]{4,12}$/;

const getBuildingCode = (id = '') => {
  const normalized = String(id).trim();
  if (!normalized) return '';
  const firstChunk = normalized.split('-')[0];
  return firstChunk.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
};

const hasOnlinePayment = (methods) => {
  const list = Array.isArray(methods) ? methods : String(methods || '').split(',').map((m) => m.trim());
  return list.some((m) => /online/i.test(m));
};

const PAYMENT_TC_ACCEPTED = 'accepted';

/** Remove or nullify all DB rows that reference a user before deleting the account. */
async function cleanupUserReferences(userId) {
  const { data: inquiries } = await supabase
    .from('building_inquiries')
    .select('id')
    .eq('user_id', userId);
  const inquiryIds = inquiries?.map((i) => i.id) || [];

  const steps = [];

  if (inquiryIds.length) {
    steps.push(supabase.from('referrals').delete().in('inquiry_id', inquiryIds));
  }

  steps.push(
    supabase.from('referrals').delete().eq('referrer_id', userId),
    supabase.from('join_requests').delete().eq('user_id', userId),
    supabase.from('maintenance_payments').delete().eq('user_id', userId),
    supabase.from('maintenance_requests').delete().eq('user_id', userId),
    supabase.from('chats').delete().eq('user_id', userId),
    supabase.from('vehicles').delete().eq('user_id', userId),
    supabase.from('parking_reports').delete().eq('user_id', userId),
    supabase.from('notifications').delete().eq('user_id', userId),
    supabase.from('complaints').delete().eq('user_id', userId),
    supabase.from('building_inquiries').delete().eq('user_id', userId),
    supabase.from('subscriptions').delete().eq('user_id', userId),
    supabase.from('user_activity_logs').delete().eq('user_id', userId),
    supabase.from('maintenance_bills').update({ created_by: null }).eq('created_by', userId),
    supabase.from('maintenance_bills').update({ edited_by: null }).eq('edited_by', userId),
    supabase.from('society_funds').update({ set_by: null }).eq('set_by', userId),
    supabase.from('meetings').update({ created_by: null }).eq('created_by', userId),
    supabase.from('announcements').update({ created_by: null }).eq('created_by', userId),
    supabase.from('helpline_numbers').update({ created_by: null }).eq('created_by', userId),
    supabase.from('expense_entries').update({ added_by: null }).eq('added_by', userId),
    supabase.from('expense_entries').update({ edited_by: null }).eq('edited_by', userId),
    supabase.from('expense_edit_logs').update({ edited_by: null }).eq('edited_by', userId),
    supabase.from('society_rules').update({ created_by: null }).eq('created_by', userId),
    supabase.from('society_rules').update({ updated_by: null }).eq('updated_by', userId),
    supabase.from('newspaper_editions').update({ uploaded_by: null }).eq('uploaded_by', userId),
    supabase.from('newspaper_url_patterns').update({ updated_by: null }).eq('updated_by', userId),
    supabase.from('promo_codes').update({ used_by: null }).eq('used_by', userId),
    supabase.from('promo_codes').update({ created_by: null }).eq('created_by', userId),
    supabase.from('qr_photos').update({ uploaded_by: null }).eq('uploaded_by', userId),
  );

  await Promise.allSettled(steps);
}

// Admin: create building only (no pramukh)
exports.createBuildingOnly = async (req, res) => {
  const {
    name, address,
    has_wings, wings, late_fees_enabled, late_fees_amount,
    water_reading_enabled, payment_methods, terms_accepted
  } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: 'Building name is required' });
  if (name.trim().length > 150) return res.status(422).json({ error: 'Building name must not exceed 150 characters' });
  if (address && address.trim().length > 300) return res.status(422).json({ error: 'Address must not exceed 300 characters' });

  const onlineSelected = hasOnlinePayment(payment_methods);
  if (onlineSelected && !terms_accepted) {
    return res.status(422).json({ error: 'You must accept the Easebuzz payment terms and conditions to enable online payments' });
  }

  const building_id = uuidv4();

  const payload = {
    id: building_id,
    name: name.trim(),
    address: address?.trim() || null,
    has_wings: !!has_wings,
    wings: has_wings ? wings?.trim() || null : null,
    late_fees_enabled: !!late_fees_enabled,
    late_fees_amount: late_fees_enabled ? Number(late_fees_amount) : null,
    water_reading_enabled: !!water_reading_enabled,
    payment_method: Array.isArray(payment_methods) ? payment_methods.join(', ') : 'Online',
    payment_tc: onlineSelected && terms_accepted ? PAYMENT_TC_ACCEPTED : null,
  };

  const { error } = await supabase.from('buildings').insert(payload);
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'Building created', building_id, payment_tc: payload.payment_tc });
};

// Admin: create pramukh for an existing building
exports.createPramukh = async (req, res) => {
  const { building_id, name, email, password, phone } = req.body;
  if (!building_id || !name?.trim() || !email?.trim() || !password)
    return res.status(400).json({ error: 'building_id, name, email and password are required' });
  if (!EMAIL_RE.test(email.trim())) return res.status(422).json({ error: 'Invalid email address' });
  if (password.length < 8) return res.status(422).json({ error: 'Password must be at least 8 characters' });
  if (phone && !PHONE_RE.test(phone.trim())) return res.status(422).json({ error: 'Phone must be a valid 10-digit Indian mobile number' });
  const bcrypt = require('bcryptjs');
  const { data: building } = await supabase.from('buildings').select('id').eq('id', building_id).single();
  if (!building) return res.status(404).json({ error: 'Building not found' });
  const hash = await bcrypt.hash(password, 10);
  const { error } = await supabase.from('users').insert({
    name: name.trim(), email: email.toLowerCase().trim(), password_hash: hash,
    role: 'pramukh', building_id, status: 'approved',
    phone: phone?.trim() || null,
  });
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'Pramukh created successfully' });
};

// Admin: create building and assign pramukh (legacy, keep for compatibility)
exports.createBuilding = async (req, res) => {
  const { name, address, pramukh_email, pramukh_name, pramukh_password } = req.body;
  if (!name?.trim() || !pramukh_email?.trim() || !pramukh_name?.trim() || !pramukh_password)
    return res.status(422).json({ error: 'name, pramukh_email, pramukh_name and pramukh_password are required' });
  if (!EMAIL_RE.test(pramukh_email.trim())) return res.status(422).json({ error: 'Invalid pramukh email address' });
  if (pramukh_password.length < 8) return res.status(422).json({ error: 'Password must be at least 8 characters' });
  const bcrypt = require('bcryptjs');

  const building_id = uuidv4();
  const { error: bErr } = await supabase.from('buildings').insert({ id: building_id, name, address });
  if (bErr) return res.status(400).json({ error: bErr.message });

  const hash = await bcrypt.hash(pramukh_password, 10);
  const { error: uErr } = await supabase.from('users').insert({
    name: pramukh_name, email: pramukh_email, password_hash: hash,
    role: 'pramukh', building_id, status: 'approved'
  });
  if (uErr) return res.status(400).json({ error: uErr.message });

  res.status(201).json({ message: 'Building created', building_id });
};

// User: request to join building
exports.requestJoin = async (req, res) => {
  const { building_id, building_code } = req.body || {};
  const user_id = req.user.id;
  let resolvedBuildingId = building_id ? String(building_id).trim() : '';

  if (!resolvedBuildingId && building_code) {
    const normalizedCode = String(building_code).trim().toLowerCase();
    // UUID first segment is always 8 hex chars; validate accordingly
    if (!/^[0-9a-f]{8}$/.test(normalizedCode)) {
      return res.status(422).json({ error: 'Invalid building code. It must be exactly 8 characters (e.g. BCABE917).' });
    }
    // Use a UUID range instead of ILIKE — PostgreSQL UUID comparisons need no text cast
    const lower = `${normalizedCode}-0000-0000-0000-000000000000`;
    const upper = `${normalizedCode}-ffff-ffff-ffff-ffffffffffff`;
    const { data: matched, error: matchErr } = await supabase
      .from('buildings')
      .select('id')
      .gte('id', lower)
      .lte('id', upper)
      .limit(2);
    if (matchErr) return res.status(400).json({ error: matchErr.message });
    if (!matched || matched.length === 0) return res.status(404).json({ error: 'Building not found' });
    if (matched.length > 1) return res.status(409).json({ error: 'Building code is not unique. Use full Building ID.' });
    resolvedBuildingId = matched[0].id;
  }

  if (!resolvedBuildingId) return res.status(422).json({ error: 'building_id or building_code is required' });

  const { data: building } = await supabase.from('buildings').select('id').eq('id', resolvedBuildingId).single();
  if (!building) return res.status(404).json({ error: 'Building not found' });

  // Prevent duplicate pending requests
  const { data: existing } = await supabase
    .from('join_requests').select('id, status').eq('user_id', user_id).eq('building_id', resolvedBuildingId).single();
  if (existing?.status === 'pending') return res.status(400).json({ error: 'You already have a pending request for this building' });
  if (existing?.status === 'approved') return res.status(400).json({ error: 'You are already a member of this building' });

  const { error } = await supabase.from('join_requests').insert({ user_id, building_id: resolvedBuildingId, status: 'pending' });
  if (error) return res.status(400).json({ error: error.message });

  await ns.notifyPramukh(resolvedBuildingId, {
    type: 'join_request',
    meta: { requester_id: user_id, building_id: resolvedBuildingId },
    build: (lang) => createCopy(lang).joinRequest(userDisplayName(req.user)),
  });

  res.json({ message: 'Join request sent', building_code: getBuildingCode(resolvedBuildingId) });
};

// Pramukh: approve or reject join request
exports.handleJoinRequest = async (req, res) => {
  const { request_id, action } = req.body;
  const building_id = req.user.building_id;

  if (!request_id) return res.status(422).json({ error: 'request_id is required' });
  if (!['approve', 'reject'].includes(action)) return res.status(422).json({ error: 'action must be approve or reject' });

  const { data: req_data } = await supabase
    .from('join_requests').select('*').eq('id', request_id).eq('building_id', building_id).single();
  if (!req_data) return res.status(404).json({ error: 'Request not found' });

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  await supabase.from('join_requests').update({ status: newStatus }).eq('id', request_id);

  if (action === 'approve') {
    await supabase.from('users').update({ building_id, status: 'approved' }).eq('id', req_data.user_id);
  }

  await ns.notifyUser(req_data.user_id, {
    type: 'join_response',
    meta: { building_id },
    build: (lang) => (action === 'approve'
      ? createCopy(lang).joinApproved()
      : createCopy(lang).joinRejected()),
  });

  res.json({ message: `Request ${action}d` });
};

// Get all buildings (admin)
exports.getAllBuildings = async (req, res) => {
  // 1. Fetch all buildings
  const { data: buildings, error: bErr } = await supabase.from('buildings').select('*').order('created_at', { ascending: false });
  if (bErr) return res.status(400).json({ error: bErr.message });

  // 2. Fetch users to get pramukh name and member counts
  const { data: users, error: uErr } = await supabase.from('users').select('id, name, email, role, building_id');
  if (uErr) return res.status(400).json({ error: uErr.message });

  // 3. Fetch subscriptions for pramukhs
  const pramukhIds = users.filter(u => u.role === 'pramukh').map(u => u.id);
  const { data: subs, error: sErr } = await supabase.from('subscriptions').select('user_id, status').in('user_id', pramukhIds);
  if (sErr) return res.status(400).json({ error: sErr.message });

  // 4. Enrich buildings data
  const enriched = buildings.map(b => {
    const bUsers = users.filter(u => u.building_id === b.id);
    const pramukh = bUsers.find(u => u.role === 'pramukh');
    const sub = subs.find(s => s.user_id === pramukh?.id);

    return {
      ...b,
      building_code: getBuildingCode(b.id),
      pramukh_name: pramukh ? userDisplayName(pramukh) : null,
      member_count: bUsers.length,
      subscription_status: sub?.status || 'inactive'
    };
  });

  res.json(enriched);
};

// Search buildings by name for users joining
exports.searchBuildings = async (req, res) => {
  const { query } = req.query;
  if (!query || query.trim().length < 2) return res.json([]);
  const normalizedQuery = query.trim();
  const { data, error } = await supabase
    .from('buildings')
    .select('id, name, address')
    .ilike('name', `%${normalizedQuery}%`)
    .limit(10);
  if (error) return res.status(400).json({ error: error.message });
  res.json((data || []).map((b) => ({ ...b, building_code: getBuildingCode(b.id) })));
};

// Verify a building code and return the matched building (used by join screen)
// Uses UUID range (gte/lte) to avoid the "operator does not exist: uuid ~~* unknown" error
// that happens when trying to ILIKE on a UUID column, even with ::text casts.
exports.verifyBuildingCode = async (req, res) => {
  const { code } = req.query;
  if (!code?.trim()) return res.status(400).json({ error: 'code is required' });

  const normalized = code.trim().toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(normalized))
    return res.status(422).json({ error: 'Invalid building code. It must be exactly 8 characters (e.g. BCABE917).' });

  // Any UUID starting with the 8-char code falls in this range — no text cast needed
  const lower = `${normalized}-0000-0000-0000-000000000000`;
  const upper = `${normalized}-ffff-ffff-ffff-ffffffffffff`;

  const { data, error } = await supabase
    .from('buildings')
    .select('id, name, address')
    .gte('id', lower)
    .lte('id', upper)
    .limit(2);

  if (error) return res.status(400).json({ error: error.message });
  if (!data || data.length === 0)
    return res.status(404).json({ error: 'No building found with that code. Check with your Pramukh.' });
  if (data.length > 1)
    return res.status(409).json({ error: 'Multiple buildings match this code. Please use the full Building ID.' });

  const building = data[0];
  res.json({ ...building, building_code: getBuildingCode(building.id) });
};

// Get building members (pramukh/admin)
exports.getBuildingMembers = async (req, res) => {
  const building_id = req.user.role === 'admin' ? req.params.building_id : req.user.building_id;
  // Admins get the full profile (incl. referral_code) for the user-detail
  // modal; pramukh/user get a lighter projection.
  const columns = req.user.role === 'admin'
    ? 'id, name, email, phone, role, status, flat_no, wing, total_members, referral_code, created_at'
    : 'id, name, email, phone, role, status, flat_no, wing';
  const { data, error } = await supabase
    .from('users')
    .select(columns)
    .eq('building_id', building_id)
    .order('flat_no', { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
  res.json((data || []).map((u) => withDisplayUser(u)));
};

// Get pending join requests for pramukh
exports.getPendingRequests = async (req, res) => {
  const { data, error } = await supabase
    .from('join_requests')
    .select('*, users(name, email, phone)')
    .eq('building_id', req.user.building_id)
    .eq('status', 'pending');
  if (error) return res.status(400).json({ error: error.message });
  res.json(mapRowsWithDisplayUsers(data ?? []));
};

// Admin: get bank details for a building (legacy stub — overwritten by wing-aware export below)
exports.getBankDetails = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });
  const wing = normalizeBankWing(req.query.wing);
  const { data, error } = await supabase
    .from('building_bank_details')
    .select('*')
    .eq('building_id', building_id)
    .eq('wing', wing)
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || {});
};

// Admin: upsert bank details for a building (legacy - keeping for compatibility)
exports.saveBankDetailsLegacy = async (req, res) => {
  const building_id = req.user.building_id || req.body.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });
  const { bank_name, bank_branch, bank_ifsc, bank_account, beneficiary_name, contact_name, contact_email, contact_mobile } = req.body;

  if (bank_ifsc && !IFSC_RE.test(bank_ifsc.toUpperCase().trim()))
    return res.status(422).json({ error: 'IFSC code must be 11 characters (e.g. SBIN0001234)' });
  if (bank_account && (!/^\d{9,18}$/.test(bank_account.trim())))
    return res.status(422).json({ error: 'Bank account number must be 9-18 digits' });

  const { data: existing } = await supabase
    .from('building_bank_details')
    .select('id')
    .eq('building_id', building_id)
    .single();

  const payload = {
    building_id, bank_name, bank_branch, bank_ifsc, bank_account,
    beneficiary_name: beneficiary_name?.trim() || null,
    contact_name: contact_name?.trim() || null,
    contact_email: contact_email?.trim() || null,
    contact_mobile: contact_mobile?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  let error;
  if (existing) {
    ({ error } = await supabase.from('building_bank_details').update(payload).eq('building_id', building_id));
  } else {
    ({ error } = await supabase.from('building_bank_details').insert(payload));
  }

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Bank details saved' });
};

// Admin: get all users across all buildings
exports.getAllUsers = async (req, res) => {
  const { building_id, role, search } = req.query;

  let query = supabase
    .from('users')
    .select('id, name, email, phone, role, status, flat_no, wing, total_members, referral_code, created_at, building_id, buildings(name)')
    .order('name', { ascending: true });

  if (building_id) query = query.eq('building_id', building_id);
  if (role) query = query.eq('role', role);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  // Client-side search filter
  const mapped = (data || []).map((u) => withDisplayUser(u));
  const result = search
    ? mapped.filter((u) =>
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase())
    )
    : mapped;

  res.json(result);
};

// Admin: create a user directly (any role)
exports.adminCreateUser = async (req, res) => {
  const { name, email, phone, password, role, building_id, flat_no } = req.body;
  if (!name?.trim() || !email?.trim() || !password || !role)
    return res.status(422).json({ error: 'name, email, password and role are required' });
  if (!EMAIL_RE.test(email.trim())) return res.status(422).json({ error: 'Invalid email address' });
  if (password.length < 8) return res.status(422).json({ error: 'Password must be at least 8 characters' });
  if (phone && !PHONE_RE.test(phone.trim())) return res.status(422).json({ error: 'Phone must be a valid 10-digit Indian mobile number' });
  const VALID_ROLES = ['user', 'pramukh', 'admin'];
  if (!VALID_ROLES.includes(role)) return res.status(422).json({ error: 'Invalid role' });

  const bcrypt = require('bcryptjs');
  const normalizedEmail = email.toLowerCase().trim();

  const { data: existing } = await supabase.from('users').select('id').eq('email', normalizedEmail).single();
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const hash = await bcrypt.hash(password, 12);
  const { data, error } = await supabase.from('users').insert({
    name: name.trim(),
    email: normalizedEmail,
    password_hash: hash,
    phone: phone?.trim() || null,
    role,
    building_id: building_id || null,
    flat_no: flat_no?.trim() || null,
    status: 'approved',
  }).select('id, name, email, role, building_id, flat_no').single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'User created', user: data });
};

// User/Pramukh: get own building info
// Admin: can pass building_id as query param
exports.getMyBuilding = async (req, res) => {
  // Admin can query any building via building_id param
  const building_id = req.user.role === 'admin' && req.query.building_id 
    ? req.query.building_id 
    : req.user.building_id;
    
  if (!building_id) return res.status(404).json({ error: 'No building associated' });
  
  const { data, error } = await supabase
    .from('buildings')
    .select('id, name, address, society_logo, payment_method, payment_tc, has_wings, wings, late_fees_enabled, late_fees_amount, water_reading_enabled, created_at')
    .eq('id', building_id)
    .single();
    
  if (error || !data) return res.status(404).json({ error: 'Building not found' });
  res.json(data);
};

// Admin: promote a user → pramukh
exports.adminPromoteToPramukh = async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(422).json({ error: 'user_id is required' });

  const { data: user, error: fetchErr } = await supabase
    .from('users')
    .select('id, role, building_id, name, email, expo_push_token, app_language')
    .eq('id', user_id)
    .single();
  if (fetchErr || !user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin') return res.status(403).json({ error: 'Cannot change admin role' });
  if (user.role === 'pramukh') return res.status(400).json({ error: 'User is already a pramukh' });
  if (!user.building_id) return res.status(400).json({ error: 'User must be assigned to a building before being promoted' });

  const { error } = await supabase
    .from('users')
    .update({ role: 'pramukh', status: 'approved' })
    .eq('id', user_id);
  if (error) return res.status(400).json({ error: error.message });

  // Best-effort notification — don't fail the request if it errors.
  try {
    await ns.notifyRecipients([user], {
      type: 'role_change',
      meta: { role: 'pramukh' },
      build: (lang) => createCopy(lang).promotedPramukh(),
    });
  } catch (_) { /* noop */ }

  res.json({ message: 'User promoted to pramukh', user_id, role: 'pramukh' });
};

// Admin: demote a pramukh → user
exports.adminDemoteToUser = async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(422).json({ error: 'user_id is required' });

  const { data: user, error: fetchErr } = await supabase
    .from('users')
    .select('id, role, expo_push_token, app_language')
    .eq('id', user_id)
    .single();
  if (fetchErr || !user) return res.status(404).json({ error: 'User not found' });
  if (user.role !== 'pramukh') return res.status(400).json({ error: 'Only a pramukh can be demoted' });

  const { error } = await supabase
    .from('users')
    .update({ role: 'user' })
    .eq('id', user_id);
  if (error) return res.status(400).json({ error: error.message });

  try {
    await ns.notifyRecipients([user], {
      type: 'role_change',
      meta: { role: 'user' },
      build: (lang) => createCopy(lang).demotedToUser(),
    });
  } catch (_) { /* noop */ }

  res.json({ message: 'Pramukh demoted to user', user_id, role: 'user' });
};

// Admin: delete a user
exports.adminDeleteUser = async (req, res) => {
  const { user_id } = req.params;

  // Prevent deleting admin itself
  const { data: target } = await supabase.from('users').select('role, email').eq('id', user_id).single();
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'admin') return res.status(403).json({ error: 'Cannot delete admin account' });

  try {
    await cleanupUserReferences(user_id);

    const { error } = await supabase.from('users').delete().eq('id', user_id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error('[Admin] Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user', details: err.message });
  }
};

// ── Bank Details ─────────────────────────────────────────────────────────────

// GET /buildings/bank-details?building_id=&wing=
exports.getBankDetails = async (req, res) => {
  const building_id = req.query.building_id || req.user.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });

  const wing = normalizeBankWing(req.query.wing);
  const { data, error } = await supabase
    .from('building_bank_details')
    .select('*')
    .eq('building_id', building_id)
    .eq('wing', wing)
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data || { wing });
};

// POST /buildings/bank-details  (body: building_id, wing, bank fields…)
exports.saveBankDetails = async (req, res) => {
  const building_id = req.body.building_id || req.user.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });

  const {
    bank_name, bank_ifsc, bank_account, beneficiary_name, razorpay_account_id,
    bank_branch, contact_name, contact_email, contact_mobile,
  } = req.body;
  const wing = normalizeBankWing(req.body.wing);

  if (!bank_account?.trim() || !bank_ifsc?.trim())
    return res.status(422).json({ error: 'Account number and IFSC are required' });

  const ifsc = bank_ifsc.trim().toUpperCase();
  if (!IFSC_RE.test(ifsc))
    return res.status(422).json({ error: 'Invalid IFSC code format (e.g. SBIN0001234)' });

  const payload = {
    building_id,
    wing,
    bank_name: bank_name?.trim() || null,
    bank_branch: bank_branch?.trim() || null,
    bank_ifsc: ifsc,
    bank_account: bank_account.trim(),
    beneficiary_name: beneficiary_name?.trim() || null,
    contact_name: contact_name?.trim() || null,
    contact_email: contact_email?.trim() || null,
    contact_mobile: contact_mobile?.trim() || null,
    razorpay_account_id: razorpay_account_id?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('building_bank_details')
    .upsert(payload, { onConflict: 'building_id,wing' });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Bank details saved', ...payload });
};

// Admin: delete building and all related data
exports.deleteBuilding = async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'Building ID is required' });

  try {
    console.log(`[Admin] Starting deep delete for building: ${id}`);

    // 1. Get all user IDs for this building to clean up user-linked tables
    const { data: buildingUsers } = await supabase.from('users').select('id').eq('building_id', id);
    const userIds = buildingUsers?.map(u => u.id) || [];
    console.log(`[Admin] Found ${userIds.length} users to clean up`);

    // 2. Phase 1: Delete records directly linked to building_id (parallel execution for performance)
    console.log('[Admin] Phase 1: Deleting building-scoped records...');
    const buildingScopedDeletes = [
      supabase.from('maintenance_payments').delete().eq('building_id', id),
      supabase.from('maintenance_bills').delete().eq('building_id', id),
      supabase.from('maintenance_requests').delete().eq('building_id', id),
      supabase.from('complaints').delete().eq('building_id', id),
      supabase.from('visitors').delete().eq('building_id', id),
      supabase.from('vehicles').delete().eq('building_id', id),
      supabase.from('parking_reports').delete().eq('building_id', id),
      supabase.from('chats').delete().eq('building_id', id),
      supabase.from('meetings').delete().eq('building_id', id),
      supabase.from('society_funds').delete().eq('building_id', id),
      supabase.from('expense_entries').delete().eq('building_id', id),
      supabase.from('expense_edit_logs').delete().eq('building_id', id),
      supabase.from('society_rules').delete().eq('building_id', id),
      supabase.from('helpline_numbers').delete().eq('building_id', id),
      supabase.from('building_bank_details').delete().eq('building_id', id),
      supabase.from('join_requests').delete().eq('building_id', id),
      supabase.from('announcements').delete().eq('building_id', id),
      supabase.from('qr_photos').delete().eq('building_id', id),
    ];

    await Promise.allSettled(buildingScopedDeletes);

    // 3. Phase 2: Delete user-specific records that don't have building_id (parallel execution)
    if (userIds.length > 0) {
      console.log(`[Admin] Phase 2: Deleting user-scoped records for ${userIds.length} users...`);
      
      // First, get building_inquiries IDs for this building to clean referrals
      const { data: inquiries } = await supabase
        .from('building_inquiries')
        .select('id')
        .eq('id', id);
      const inquiryIds = inquiries?.map(i => i.id) || [id]; // Use building id as inquiry id might be same
      
      const userScopedDeletes = [
        inquiryIds.length > 0 ? supabase.from('referrals').delete().in('inquiry_id', inquiryIds) : Promise.resolve({}),
        supabase.from('referrals').delete().in('referrer_id', userIds),
        supabase.from('building_inquiries').delete().in('user_id', userIds),
        // Delete promo codes (both used_by and created_by FKs)
        supabase.from('promo_codes').delete().in('used_by', userIds),
        supabase.from('promo_codes').delete().in('created_by', userIds),
        // Delete QR photos and newspaper updates
        supabase.from('qr_photos').delete().in('uploaded_by', userIds),
        supabase.from('newspapers').delete().in('updated_by', userIds),
        // Delete other user-scoped records
        supabase.from('subscriptions').delete().in('user_id', userIds),
        supabase.from('notifications').delete().in('user_id', userIds),
        supabase.from('join_requests').delete().in('user_id', userIds),
      ];
      
      await Promise.allSettled(userScopedDeletes);
    }

    // 4. Phase 3: Delete building inquiry if exists (by building id)
    console.log('[Admin] Phase 3: Deleting building inquiry...');
    await supabase.from('building_inquiries').delete().eq('id', id);

    // 5. Phase 4: Delete users (now safe - all references removed)
    console.log('[Admin] Phase 4: Deleting users...');
    const { error: uErr } = await supabase.from('users').delete().eq('building_id', id);
    if (uErr) {
      console.error('[Admin] Error deleting users:', uErr);
      return res.status(500).json({ 
        error: 'Failed to delete users',
        details: uErr.message,
        hint: 'Some user records may have external dependencies. Please contact support.'
      });
    }

    // 6. Final Phase: Delete the building
    console.log('[Admin] Final phase: Deleting building...');
    const { error: bErr } = await supabase.from('buildings').delete().eq('id', id);
    if (bErr) {
      console.error('[Admin] Error deleting building:', bErr);
      return res.status(500).json({ 
        error: 'Failed to delete building',
        details: bErr.message
      });
    }

    console.log(`[Admin] Successfully deleted building ${id} and all related data.`);
    res.json({ 
      message: 'Building and all associated data deleted successfully',
      deleted_users: userIds.length,
      building_id: id
    });
  } catch (error) {
    console.error('[Admin] Delete building error:', error);
    res.status(500).json({ 
      error: 'Failed to delete building',
      details: error.message,
      code: error.code || 'UNKNOWN'
    });
  }
};

// Admin: update building details
exports.updateBuilding = async (req, res) => {
  const { id } = req.params;
  const {
    name, address, city, state,
    has_wings, wings, late_fees_enabled, late_fees_amount,
    water_reading_enabled, payment_methods, society_logo, payment_tc,
    terms_accepted
  } = req.body;

  if (!id) return res.status(400).json({ error: 'Building ID is required' });
  
  // Check if building exists
  const { data: existingBuilding, error: fetchError } = await supabase
    .from('buildings')
    .select('id, payment_method, payment_tc')
    .eq('id', id)
    .single();
    
  if (fetchError || !existingBuilding) {
    return res.status(404).json({ error: 'Building not found' });
  }

  const onlineSelected = payment_methods !== undefined
    ? hasOnlinePayment(payment_methods)
    : hasOnlinePayment(existingBuilding.payment_method);

  const alreadyAccepted = existingBuilding.payment_tc === PAYMENT_TC_ACCEPTED || !!existingBuilding.payment_tc;
  if (onlineSelected && !alreadyAccepted && !terms_accepted) {
    return res.status(422).json({ error: 'You must accept the Easebuzz payment terms and conditions to enable online payments' });
  }

  // Validate input
  const updatePayload = {};
  
  if (name !== undefined) {
    if (!name?.trim()) return res.status(400).json({ error: 'Building name cannot be empty' });
    if (name.trim().length > 150) return res.status(422).json({ error: 'Building name must not exceed 150 characters' });
    updatePayload.name = name.trim();
  }
  
  if (address !== undefined) {
    if (address && address.trim().length > 300) return res.status(422).json({ error: 'Address must not exceed 300 characters' });
    updatePayload.address = address?.trim() || null;
  }
  
  if (city !== undefined) updatePayload.city = city?.trim() || null;
  if (state !== undefined) updatePayload.state = state?.trim() || null;
  
  if (has_wings !== undefined) {
    updatePayload.has_wings = !!has_wings;
    if (has_wings && wings !== undefined) {
      updatePayload.wings = wings?.trim() || null;
    } else if (!has_wings) {
      updatePayload.wings = null;
    }
  }
  
  if (late_fees_enabled !== undefined) {
    updatePayload.late_fees_enabled = !!late_fees_enabled;
    if (late_fees_enabled && late_fees_amount !== undefined) {
      updatePayload.late_fees_amount = Number(late_fees_amount);
    } else if (!late_fees_enabled) {
      updatePayload.late_fees_amount = null;
    }
  }
  
  if (water_reading_enabled !== undefined) {
    updatePayload.water_reading_enabled = !!water_reading_enabled;
  }
  
  if (payment_methods !== undefined) {
    updatePayload.payment_method = Array.isArray(payment_methods) ? payment_methods.join(', ') : payment_methods || 'Online';
  }
  
  if (society_logo !== undefined) updatePayload.society_logo = society_logo?.trim() || null;
  if (payment_tc !== undefined) updatePayload.payment_tc = payment_tc?.trim() || null;
  if (onlineSelected && (terms_accepted || alreadyAccepted) && !updatePayload.payment_tc) {
    updatePayload.payment_tc = PAYMENT_TC_ACCEPTED;
  }
  if (!onlineSelected) updatePayload.payment_tc = null;

  const { error } = await supabase
    .from('buildings')
    .update(updatePayload)
    .eq('id', id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Building updated successfully', building_id: id });
};

// Get payment terms and conditions
exports.getPaymentTerms = async (req, res) => {
  const terms = {
    app_owner: 'M & A Technology',
    payment_gateway: 'Easebuzz',
    title: 'Easebuzz Payment Gateway — Terms & Conditions',
  sections: [
    {
      heading: 'App Ownership',
      body: 'App ownership always belongs to M & A Technology. Any prior developer attribution was added in error; the sole owner of this platform is M & A Technology.',
    },
    {
      heading: 'Payment Collection & Settlement',
      body: 'We collect maintenance and society payments from residents on behalf of the society. After T+1 business days, funds are credited directly to the society\'s registered bank account. There is no intermediary between the member and the society account — money flows transparently from resident to society.',
      note: 'Direct T+1 settlement is being rolled out and will be available soon on the development environment.',
    },
    {
      heading: 'Connected Societies',
      body: 'We are actively onboarding more societies including Prince Heaven, Nilkanth Elegance, and others. The same payment terms apply uniformly across all connected societies.',
    },
    {
      heading: 'Transparency Principle',
      body: 'All transactions are visible to both the society account administrators and residents through the integrated Expense Tracker module. We also use detection algorithms to improve accuracy, reduce errors, and deliver a better user experience.',
    },
    {
      heading: 'Dispute Resolution Policy',
      body: 'A common policy is applied across all societies to resolve payment and maintenance disputes fairly and consistently.',
    },
    {
      heading: 'Society & Administrator Verification',
      body: 'Societies and administrators are verified through a multi-step process. Administrators must provide society registration documents, authorized committee member details, and contact information. Email addresses and mobile numbers are verified via OTP-based authentication. Only approved administrators may manage society data, ensuring residents interact with legitimate representatives.',
    },
    {
      heading: 'Platform Role & Records',
      body: 'Our platform acts as a communication and record-keeping system, maintaining a transparent history of complaints, requests, notices, and responses. In case of disputes, both residents and society administrators can refer to these records. The platform facilitates communication and escalation to authorized committee members; final dispute resolution remains the responsibility of the society\'s governing body and applicable local regulations.',
    },
  ],
    acceptance_text: 'By enabling online payments, you confirm that you have read, understood, and agree to all terms and conditions listed above.',
  };
  
  res.json(terms);
};

// Check if payment terms were accepted for a building
exports.checkTermsAccepted = async (req, res) => {
  const { building_id } = req.query;
  
  if (!building_id) return res.status(400).json({ error: 'Building ID is required' });
  
  const { data: building, error } = await supabase
    .from('buildings')
    .select('id, payment_tc, payment_method')
    .eq('id', building_id)
    .single();

  if (error || !building) return res.status(404).json({ error: 'Building not found' });

  const accepted = !!building.payment_tc;
  
  res.json({ 
    terms_accepted: accepted,
    building_id,
    has_online_payment: hasOnlinePayment(building.payment_method),
    message: accepted ? 'Terms already accepted' : 'Terms not accepted yet',
  });
};

// Accept payment terms for an existing building
exports.acceptPaymentTerms = async (req, res) => {
  const { building_id, accept } = req.body;
  
  if (!building_id) return res.status(400).json({ error: 'Building ID is required' });
  if (accept !== true) return res.status(400).json({ error: 'Must accept terms to proceed' });

  const { data: building, error: fetchErr } = await supabase
    .from('buildings')
    .select('id')
    .eq('id', building_id)
    .single();
  if (fetchErr || !building) return res.status(404).json({ error: 'Building not found' });

  const { error } = await supabase
    .from('buildings')
    .update({ payment_tc: PAYMENT_TC_ACCEPTED })
    .eq('id', building_id);

  if (error) return res.status(400).json({ error: error.message });
  
  res.json({ 
    success: true,
    message: 'Payment terms accepted successfully',
    building_id,
    accepted_at: new Date().toISOString(),
    app_owner: 'M & A Technology',
  });
};