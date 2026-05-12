const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const supabase = require('../supabase');
const { logActivity } = require('../utils/activityLogger');

// Helper: fetch active subscription for a user
const getSubscription = async (user_id) => {
  const { data } = await supabase
    .from('subscriptions')
    .select('plan, status, expires_at')
    .eq('user_id', user_id)
    .single();
  return data || null;
};

const signToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

// Get current user (refresh profile/building_id after approval)
exports.getMe = async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, role, building_id, flat_no, status, phone, wing, total_members')
    .eq('id', req.user.id)
    .single();
  if (error || !data) return res.status(404).json({ error: 'User not found' });
  res.json({ user: data });
};

// Unified login — auto-detects admin, pramukh, or user by email+password
exports.unifiedLogin = async (req, res) => {
  const { email, password } = req.body;
  if (!email?.trim() || !password)
    return res.status(422).json({ error: 'Email and password are required' });

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_RE.test(email.trim())) {
    logActivity({ email: email.trim() }, 'login_failed', 'auth', { reason: 'Invalid email format' }, req.ip, 'info');
    return res.status(422).json({ error: 'Please enter a valid email address' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // 1. Check if admin
  if (normalizedEmail === process.env.ADMIN_EMAIL?.toLowerCase().trim()) {
    // Ensure admin has a real UUID row in users table
    let { data: adminUser } = await supabase
      .from('users')
      .select('id, name, email, role, password_hash')
      .eq('email', normalizedEmail)
      .single();

    let valid = false;
    if (adminUser && adminUser.password_hash && adminUser.password_hash !== 'admin-no-direct-login') {
      valid = await bcrypt.compare(password, adminUser.password_hash);
    }
    if (!valid && password === process.env.ADMIN_PASSWORD) {
      valid = true;
    }

    if (!valid) {
      logActivity({ email: normalizedEmail, role: 'admin' }, 'login_failed', 'auth', { reason: 'Invalid admin credentials' }, req.ip, 'info');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!adminUser) {
      const { data: created, error: createErr } = await supabase
        .from('users')
        .insert({ name: 'Admin', email: normalizedEmail, role: 'admin', status: 'approved', password_hash: 'admin-no-direct-login' })
        .select('id, name, email, role')
        .single();
      if (createErr) return res.status(500).json({ error: 'Failed to create admin record: ' + createErr.message });
      adminUser = created;
    }

    if (!adminUser) return res.status(500).json({ error: 'Admin record could not be resolved' });

    logActivity({ id: adminUser.id, name: 'Admin', role: 'admin' }, 'login_success', 'auth', {}, req.ip, 'info');
    const token = signToken({ id: adminUser.id, role: 'admin', name: 'Admin', email: normalizedEmail });
    return res.json({ token, user: { id: adminUser.id, name: 'Admin', email: normalizedEmail, role: 'admin' } });
  }

  // 2. Look up in DB (pramukh or user)
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', normalizedEmail)
    .single();

  if (error || !data) {
    logActivity({ email: normalizedEmail }, 'login_failed', 'auth', { reason: 'User not found or invalid email' }, req.ip, 'info');
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await bcrypt.compare(password, data.password_hash);
  if (!valid) {
    logActivity({ id: data.id, name: data.name, role: data.role, building_id: data.building_id }, 'login_failed', 'auth', { reason: 'Invalid password' }, req.ip, 'info');
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  logActivity({ id: data.id, name: data.name, role: data.role, building_id: data.building_id }, 'login_success', 'auth', {}, req.ip, 'info');
  const token = signToken({ id: data.id, role: data.role, name: data.name, building_id: data.building_id, flat_no: data.flat_no });
  const subscription = await getSubscription(data.id);
  return res.json({
    token,
    subscription,
    user: { id: data.id, name: data.name, email: data.email, role: data.role, building_id: data.building_id, flat_no: data.flat_no, phone: data.phone, wing: data.wing, total_members: data.total_members }
  });
};

// Fixed credential login (admin, watchman) or pramukh from DB
exports.fixedLogin = async (req, res) => {
  const { id, password, role } = req.body;

  if (!id || !password || !role)
    return res.status(422).json({ error: 'id, password and role are required' });

  const VALID_ROLES = ['admin', 'pramukh', 'watchman'];
  if (!VALID_ROLES.includes(role))
    return res.status(422).json({ error: 'Invalid role' });

  if (role === 'admin') {
    if (id !== process.env.ADMIN_ID || password !== process.env.ADMIN_PASSWORD)
      return res.status(401).json({ error: 'Invalid admin credentials' });
    return res.json({ token: signToken({ id, role: 'admin', name: 'Admin' }) });
  }

  if (role === 'watchman') {
    if (id !== process.env.WATCHMAN_ID || password !== process.env.WATCHMAN_PASSWORD)
      return res.status(401).json({ error: 'Invalid watchman credentials' });
    return res.json({ token: signToken({ id, role: 'watchman', name: 'Watchman' }) });
  }

  // Pramukh — looked up from DB by email
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', id.toLowerCase().trim())
    .eq('role', 'pramukh')
    .single();

  if (error || !data) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, data.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  return res.json({
    token: signToken({ id: data.id, role: 'pramukh', name: data.name, building_id: data.building_id }),
    subscription: await getSubscription(data.id),
    user: { id: data.id, name: data.name, email: data.email, role: 'pramukh', building_id: data.building_id, phone: data.phone, wing: data.wing, total_members: data.total_members }
  });
};

// User signup
exports.signup = async (req, res) => {
  const { name, email, password, phone, referral_code } = req.body;

  if (!name?.trim() || !email?.trim() || !password || !phone?.trim())
    return res.status(422).json({ error: 'All fields are required' });

  const normalizedEmail = email.toLowerCase().trim();

  // Check email uniqueness
  const { data: existingEmail } = await supabase
    .from('users').select('id').eq('email', normalizedEmail).single();
  if (existingEmail) return res.status(409).json({ error: 'An account with this email already exists' });

  // Check phone uniqueness
  const { data: existingPhone } = await supabase
    .from('users').select('id').eq('phone', phone.trim()).single();
  if (existingPhone) return res.status(409).json({ error: 'An account with this phone number already exists' });

  // Pre-validate referral code (if provided) BEFORE creating the user,
  // so we don't create a half-finished account on a typo'd code.
  let referrer = null;
  const trimmedCode = referral_code?.trim().toUpperCase();
  if (trimmedCode) {
    const { data: r } = await supabase
      .from('users')
      .select('id, email')
      .eq('referral_code', trimmedCode)
      .maybeSingle();
    if (!r) return res.status(422).json({ error: 'Invalid referral code' });
    if (r.email && r.email.toLowerCase() === normalizedEmail) {
      return res.status(422).json({ error: 'You cannot use your own referral code' });
    }
    referrer = r;
  }

  const hash = await bcrypt.hash(password, 12);
  const { data, error } = await supabase
    .from('users')
    .insert({ name: name.trim(), email: normalizedEmail, password_hash: hash, phone: phone.trim(), role: 'user', status: 'pending' })
    .select('id, name, email, role')
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Record referral right after signup so it appears in the referrer's
  // Refer & Earn module immediately. inquiry_id stays NULL until the
  // referee later submits a society registration; at that point the
  // inquiry controller will fill in the inquiry/society fields.
  if (referrer) {
    const { error: refErr } = await supabase.from('referrals').insert({
      referrer_id: referrer.id,
      inquiry_id: null,
      referee_name: data.name,
      referee_email: data.email,
      society_name: 'Awaiting society registration',
    });
    if (refErr) {
      console.error('Failed to record signup referral:', refErr.message);
    }
  }

  res.status(201).json({ message: 'Account created successfully', user: data });
};

// User login
exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email?.trim() || !password)
    return res.status(422).json({ error: 'Email and password are required' });

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error || !data) {
    logActivity({ email: email.toLowerCase().trim() }, 'login_failed', 'auth', { reason: 'User not found or invalid email' }, req.ip, 'info');
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await bcrypt.compare(password, data.password_hash);
  if (!valid) {
    logActivity({ id: data.id, name: data.name, role: data.role, building_id: data.building_id }, 'login_failed', 'auth', { reason: 'Invalid password' }, req.ip, 'info');
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  logActivity({ id: data.id, name: data.name, role: data.role, building_id: data.building_id }, 'login_success', 'auth', {}, req.ip, 'info');
  res.json({
    token: signToken({ id: data.id, role: data.role, name: data.name, building_id: data.building_id }),
    subscription: await getSubscription(data.id),
    user: { id: data.id, name: data.name, email: data.email, role: data.role, building_id: data.building_id, flat_no: data.flat_no, phone: data.phone, wing: data.wing, total_members: data.total_members }
  });
};

// ── Forgot Password Flow ──────────────────────────────────────────────────────

const getMailer = () => nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
});

// Step 1: Send OTP to email
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email?.trim()) return res.status(422).json({ error: 'Email is required' });

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_RE.test(email.trim())) return res.status(422).json({ error: 'Please enter a valid email address' });

  const normalizedEmail = email.toLowerCase().trim();
  const adminEnvEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim() || null;
  const isAdmin = !!adminEnvEmail && normalizedEmail === adminEnvEmail;

  // Find the user. Admins might not have a row in `users` yet if they've
  // only ever signed in via fixedLogin (ADMIN_ID). Auto-create the row
  // up-front so the OTP / verify / reset flow has something to attach to
  // and so resetPassword can update a real bcrypt hash.
  let userRow = null;
  {
    const { data } = await supabase
      .from('users')
      .select('id, role')
      .eq('email', normalizedEmail)
      .maybeSingle();
    userRow = data || null;
  }

  if (!userRow) {
    if (isAdmin) {
      // Bootstrap the admin row with a placeholder hash. The real hash will
      // overwrite this in resetPassword. Status is 'approved' so the admin
      // can sign in immediately after the reset.
      const { data: created, error: createErr } = await supabase
        .from('users')
        .insert({
          name: 'Admin',
          email: normalizedEmail,
          role: 'admin',
          status: 'approved',
          password_hash: 'admin-no-direct-login',
        })
        .select('id, role')
        .single();
      if (createErr) {
        console.error('forgotPassword: failed to bootstrap admin row:', createErr.message);
        return res.status(500).json({ error: 'Could not initialise admin account. Please contact support.' });
      }
      userRow = created;
    } else {
      // Non-admin email that isn't registered. If ADMIN_EMAIL is missing
      // and the requester *thinks* they're admin, give a clearer hint.
      if (!adminEnvEmail) {
        return res.status(404).json({
          error: 'No account found with this email. (If you are the system admin, set ADMIN_EMAIL in the backend .env first.)',
        });
      }
      return res.status(404).json({ error: 'No account found with this email' });
    }
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  // Invalidate old OTPs for this email
  await supabase.from('otp_tokens').update({ used: true }).eq('email', normalizedEmail).eq('used', false);

  // Store new OTP
  const { error } = await supabase.from('otp_tokens').insert({ email: normalizedEmail, otp, expires_at });
  if (error) return res.status(500).json({ error: 'Failed to generate OTP' });

  // Send email
  try {
    const mailer = getMailer();
    await mailer.sendMail({
      from: `"My Building App" <${process.env.MAIL_USER}>`,
      to: normalizedEmail,
      subject: 'Password Reset OTP — My Building',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#f5f7fa;border-radius:12px">
          <h2 style="color:#1E3A8A;margin-bottom:8px">🏢 My Building</h2>
          <p style="color:#374151">You requested a password reset. Use the OTP below:</p>
          <div style="background:#1E3A8A;color:#fff;font-size:36px;font-weight:800;letter-spacing:12px;text-align:center;padding:20px;border-radius:10px;margin:24px 0">${otp}</div>
          <p style="color:#6B7280;font-size:13px">This OTP expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
          <p style="color:#6B7280;font-size:13px">If you didn't request this, ignore this email.</p>
        </div>
      `,
    });
  } catch (mailErr) {
    console.error('Mail error:', mailErr);
    return res.status(500).json({ error: 'Failed to send OTP email. Check MAIL_USER/MAIL_PASS in .env' });
  }

  res.json({ message: 'OTP sent to your email' });
};

// Step 2: Verify OTP → return a short-lived reset token
exports.verifyOtp = async (req, res) => {
  const { email, otp } = req.body;
  if (!email?.trim() || !otp?.trim()) return res.status(422).json({ error: 'Email and OTP are required' });
  if (!/^\d{6}$/.test(otp.trim())) return res.status(422).json({ error: 'OTP must be a 6-digit number' });

  const normalizedEmail = email.toLowerCase().trim();

  const { data: record } = await supabase
    .from('otp_tokens')
    .select('*')
    .eq('email', normalizedEmail)
    .eq('otp', otp.trim())
    .eq('used', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!record) return res.status(400).json({ error: 'Invalid OTP' });
  if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });

  // Mark OTP as used
  await supabase.from('otp_tokens').update({ used: true }).eq('id', record.id);

  // Issue a short-lived reset token (5 min)
  const resetToken = jwt.sign({ email: normalizedEmail, purpose: 'reset' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  res.json({ message: 'OTP verified', reset_token: resetToken });
};

// Step 3: Reset password using reset token
exports.resetPassword = async (req, res) => {
  const { reset_token, new_password } = req.body;
  if (!reset_token || !new_password) return res.status(422).json({ error: 'reset_token and new_password are required' });

  // Validate password strength
  const { isStrongPassword } = require('../utils/validators');
  const pwErr = isStrongPassword(new_password, 'Password');
  if (pwErr) return res.status(422).json({ error: pwErr });

  let payload;
  try {
    payload = jwt.verify(reset_token, process.env.JWT_SECRET);
  } catch {
    return res.status(400).json({ error: 'Reset token is invalid or expired. Please start over.' });
  }

  if (payload.purpose !== 'reset') return res.status(400).json({ error: 'Invalid token' });

  const hash = await bcrypt.hash(new_password, 12);

  // forgotPassword already bootstrapped the admin row if missing, so a plain
  // update is enough here. Defensive fallback: if for some reason the row
  // disappeared between OTP and reset, recreate it for the admin email.
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', payload.email)
    .maybeSingle();

  if (!existing) {
    if (payload.email === process.env.ADMIN_EMAIL?.toLowerCase().trim()) {
      const { error: insErr } = await supabase
        .from('users')
        .insert({ name: 'Admin', email: payload.email, role: 'admin', status: 'approved', password_hash: hash });
      if (insErr) return res.status(500).json({ error: 'Failed to update password' });
      return res.json({ message: 'Password reset successfully. You can now log in.' });
    }
    return res.status(404).json({ error: 'Account no longer exists. Please start the reset flow again.' });
  }

  const { error } = await supabase.from('users').update({ password_hash: hash }).eq('email', payload.email);
  if (error) return res.status(500).json({ error: 'Failed to update password' });

  res.json({ message: 'Password reset successfully. You can now log in.' });
};
