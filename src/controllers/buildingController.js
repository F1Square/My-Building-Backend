const supabase = require('../supabase');
const { v4: uuidv4 } = require('uuid');
const ns = require('../utils/notificationService');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[6-9]\d{9}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// Admin: create building only (no pramukh)
exports.createBuildingOnly = async (req, res) => {
  const { name, address } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Building name is required' });
  if (name.trim().length > 150) return res.status(422).json({ error: 'Building name must not exceed 150 characters' });
  if (address && address.trim().length > 300) return res.status(422).json({ error: 'Address must not exceed 300 characters' });
  const { v4: uuidv4 } = require('uuid');
  const building_id = uuidv4();
  const { error } = await supabase.from('buildings').insert({ id: building_id, name: name.trim(), address: address?.trim() });
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'Building created', building_id });
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
  const { building_id } = req.body;
  const user_id = req.user.id;

  if (!building_id) return res.status(422).json({ error: 'building_id is required' });

  const { data: building } = await supabase.from('buildings').select('id').eq('id', building_id).single();
  if (!building) return res.status(404).json({ error: 'Building not found' });

  // Prevent duplicate pending requests
  const { data: existing } = await supabase
    .from('join_requests').select('id, status').eq('user_id', user_id).eq('building_id', building_id).single();
  if (existing?.status === 'pending') return res.status(400).json({ error: 'You already have a pending request for this building' });
  if (existing?.status === 'approved') return res.status(400).json({ error: 'You are already a member of this building' });

  const { error } = await supabase.from('join_requests').insert({ user_id, building_id, status: 'pending' });
  if (error) return res.status(400).json({ error: error.message });

  await ns.notifyPramukh(building_id, {
    title: 'Join Request',
    body: `${req.user.name} wants to join your building`,
    type: 'join_request',
    meta: { requester_id: user_id, building_id }
  });

  res.json({ message: 'Join request sent' });
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
    title: action === 'approve' ? 'Request Approved ✅' : 'Request Rejected',
    body: action === 'approve'
      ? 'You have been approved to join the building.'
      : 'Your join request was rejected by the Pramukh.',
    type: 'join_response',
    meta: { building_id }
  });

  res.json({ message: `Request ${action}d` });
};

// Get all buildings (admin)
exports.getAllBuildings = async (req, res) => {
  const { data, error } = await supabase.from('buildings').select('*');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Get building members (pramukh/admin)
exports.getBuildingMembers = async (req, res) => {
  const building_id = req.user.role === 'admin' ? req.params.building_id : req.user.building_id;
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, phone, role, status, flat_no, wing')
    .eq('building_id', building_id)
    .order('flat_no', { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Get pending join requests for pramukh
exports.getPendingRequests = async (req, res) => {
  const { data, error } = await supabase
    .from('join_requests')
    .select('*, users(name, email, phone)')
    .eq('building_id', req.user.building_id)
    .eq('status', 'pending');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Admin: get bank details for a building
exports.getBankDetails = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });
  const { data, error } = await supabase
    .from('building_bank_details')
    .select('*')
    .eq('building_id', building_id)
    .single();
  if (error && error.code !== 'PGRST116') return res.status(400).json({ error: error.message });
  res.json(data || {});
};

// Admin: upsert bank details for a building
exports.saveBankDetails = async (req, res) => {
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
    .select('id, name, email, phone, role, status, flat_no, building_id, buildings(name)')
    .order('name', { ascending: true });

  if (building_id) query = query.eq('building_id', building_id);
  if (role) query = query.eq('role', role);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  // Client-side search filter
  const result = search
    ? data.filter((u) =>
        u.name?.toLowerCase().includes(search.toLowerCase()) ||
        u.email?.toLowerCase().includes(search.toLowerCase())
      )
    : data;

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
exports.getMyBuilding = async (req, res) => {
  const building_id = req.user.building_id;
  if (!building_id) return res.status(404).json({ error: 'No building associated' });
  const { data, error } = await supabase
    .from('buildings')
    .select('id, name, address, society_logo, payment_method, payment_tc, created_at')
    .eq('id', building_id)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Building not found' });
  res.json(data);
};

// Admin: delete a user
exports.adminDeleteUser = async (req, res) => {
  const { user_id } = req.params;

  // Prevent deleting admin itself
  const { data: target } = await supabase.from('users').select('role, email').eq('id', user_id).single();
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'admin') return res.status(403).json({ error: 'Cannot delete admin account' });

  const { error } = await supabase.from('users').delete().eq('id', user_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'User deleted' });
};

// ── Bank Details ─────────────────────────────────────────────────────────────

// GET /buildings/bank-details
exports.getBankDetails = async (req, res) => {
  const building_id = req.query.building_id || req.user.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });

  const { data, error } = await supabase
    .from('building_bank_details')
    .select('*')
    .eq('building_id', building_id)
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data || {});
};

// POST /buildings/bank-details
exports.saveBankDetails = async (req, res) => {
  const building_id = req.body.building_id || req.user.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });

  const {
    bank_name, bank_branch, bank_ifsc, bank_account,
    beneficiary_name, contact_name, contact_email, contact_mobile,
  } = req.body;

  if (!bank_account?.trim() || !bank_ifsc?.trim())
    return res.status(422).json({ error: 'Account number and IFSC are required' });

  const ifsc = bank_ifsc.trim().toUpperCase();
  if (!IFSC_RE.test(ifsc))
    return res.status(422).json({ error: 'Invalid IFSC code format (e.g. SBIN0001234)' });

  const payload = {
    building_id,
    bank_name: bank_name?.trim() || null,
    bank_branch: bank_branch?.trim() || null,
    bank_ifsc: ifsc,
    bank_account: bank_account.trim(),
    beneficiary_name: beneficiary_name?.trim() || null,
    contact_name: contact_name?.trim() || null,
    contact_email: contact_email?.trim() || null,
    contact_mobile: contact_mobile?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('building_bank_details')
    .upsert(payload, { onConflict: 'building_id' });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Bank details saved', ...payload });
};
