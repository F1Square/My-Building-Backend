const router = require('express').Router();
const { fixedLogin, signup, login, unifiedLogin, getMe, forgotPassword, verifyOtp, resetPassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { validate, required, isEmail, minLen, isPhone, isStrongPassword } = require('../utils/validators');
const rateLimiter = require('../middleware/rateLimiter');

// Rate limiters for auth endpoints
const loginLimiter = rateLimiter(10, 60_000);       // 10 attempts/min
const signupLimiter = rateLimiter(5, 60_000);        // 5 signups/min
const forgotLimiter = rateLimiter(5, 60_000);        // 5 OTP requests/min
const otpLimiter = rateLimiter(10, 60_000);          // 10 OTP verifications/min

router.post('/fixed-login', loginLimiter, fixedLogin);
router.post('/login/unified', loginLimiter, unifiedLogin);
router.get('/me', authenticate, getMe);

router.post('/signup',
  signupLimiter,
  validate({
    name: [required('name'), minLen(2)],
    email: [required('email'), isEmail],
    password: [required('password'), isStrongPassword],
    phone: [required('phone'), isPhone],
  }),
  signup
);

router.post('/login',
  loginLimiter,
  validate({
    email: [required('email'), isEmail],
    password: [required('password')],
  }),
  login
);

router.post('/forgot-password', forgotLimiter, forgotPassword);
router.post('/verify-otp', otpLimiter, verifyOtp);
router.post('/reset-password', resetPassword);

// Save Expo push token for the logged-in user
router.post('/push-token', authenticate, async (req, res) => {
  const { expo_push_token } = req.body;
  if (!expo_push_token) return res.status(422).json({ error: 'expo_push_token is required' });
  const supabase = require('../supabase');
  await supabase.from('users').update({ expo_push_token }).eq('id', req.user.id);
  res.json({ message: 'Push token saved' });
});

// Update own profile details
router.patch('/profile', authenticate, async (req, res) => {
  const { phone, flat_no, wing, total_members } = req.body;
  const supabase = require('../supabase');
  // Fetch current user details to get existing flat_no/wing if not provided in body
  const { data: currentUser } = await supabase
    .from('users')
    .select('flat_no, wing')
    .eq('id', req.user.id)
    .single();

  const updates = {};

  if (phone !== undefined) {
    const trimmed = phone?.trim() || null;
    if (trimmed) {
      // Validate Indian mobile number (starts 6-9, exactly 10 digits)
      if (!/^[6-9]\d{9}$/.test(trimmed))
        return res.status(422).json({ error: 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9' });
      // Check uniqueness (exclude current user)
      const { data: existing } = await supabase
        .from('users').select('id').eq('phone', trimmed).neq('id', req.user.id).single();
      if (existing) return res.status(409).json({ error: 'This mobile number is already in use' });
    }
    updates.phone = trimmed;
  }

  if (flat_no !== undefined || wing !== undefined) {
    const trimmedFlat = flat_no !== undefined ? (flat_no?.trim() || null) : currentUser?.flat_no;
    const trimmedWing = wing !== undefined ? (wing?.trim() || null) : currentUser?.wing;

    if (trimmedFlat && req.user.building_id) {
      // Check flat_no + wing uniqueness within the same building (exclude current user)
      let query = supabase
        .from('users')
        .select('id')
        .eq('flat_no', trimmedFlat)
        .eq('building_id', req.user.building_id)
        .neq('id', req.user.id);
      
      if (trimmedWing) {
        query = query.eq('wing', trimmedWing);
      } else {
        query = query.is('wing', null);
      }

      const { data: existingFlat } = await query.maybeSingle();
      
      if (existingFlat) {
        const errorMsg = trimmedWing 
          ? `Flat ${trimmedFlat} in Wing ${trimmedWing} is already assigned to another resident`
          : `Flat ${trimmedFlat} is already assigned to another resident`;
        return res.status(409).json({ error: errorMsg });
      }
    }
    if (flat_no !== undefined) updates.flat_no = flat_no?.trim() || null;
    if (wing !== undefined) updates.wing = wing?.trim() || null;
  }
  if (total_members !== undefined) updates.total_members = total_members ? Number(total_members) : null;

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', req.user.id)
    .select('id, name, email, role, building_id, flat_no, phone, wing, total_members')
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Profile updated', user: data });
});

module.exports = router;
