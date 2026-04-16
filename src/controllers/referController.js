const supabase = require('../supabase');

// Charset excludes ambiguous chars: 0, O, I, 1
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return code;
}

async function getUniqueCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode();
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('referral_code', code)
      .maybeSingle();
    if (!data) return code;
  }
  throw new Error('Failed to generate unique referral code');
}

// GET /refer/my-code
exports.getMyCode = async (req, res) => {
  const { data: user, error } = await supabase
    .from('users')
    .select('referral_code')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(400).json({ error: error.message });

  if (user.referral_code) {
    return res.json({ referral_code: user.referral_code });
  }

  // Generate and persist a new code
  try {
    const code = await getUniqueCode();
    const { error: updateError } = await supabase
      .from('users')
      .update({ referral_code: code })
      .eq('id', req.user.id);
    if (updateError) return res.status(400).json({ error: updateError.message });
    return res.json({ referral_code: code });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /refer/my-referrals
exports.getMyReferrals = async (req, res) => {
  const { data, error } = await supabase
    .from('referrals')
    .select('*')
    .eq('referrer_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// GET /refer/admin/all
exports.adminGetAll = async (req, res) => {
  const { data, error } = await supabase
    .from('referrals')
    .select(`
      *,
      referrer:users!referrals_referrer_id_fkey(name, email),
      inquiry:building_inquiries!referrals_inquiry_id_fkey(society_name, status)
    `)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// POST /refer/admin/grant-subscription
exports.adminGrantSubscription = async (req, res) => {
  const { referral_id } = req.body;
  if (!referral_id) return res.status(422).json({ error: 'referral_id is required' });

  // Fetch referral
  const { data: referral, error: refErr } = await supabase
    .from('referrals')
    .select('*')
    .eq('id', referral_id)
    .single();

  if (refErr || !referral) return res.status(404).json({ error: 'Referral not found' });
  if (referral.subscription_granted_at) {
    return res.status(400).json({ error: 'Subscription already granted for this referral' });
  }

  const referrerId = referral.referrer_id;
  const now = new Date();
  const oneYearLater = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString();

  // Fetch existing subscription
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', referrerId)
    .maybeSingle();

  if (!sub) {
    // Case 1: No subscription — create new yearly
    const { error: insertErr } = await supabase.from('subscriptions').insert({
      user_id: referrerId,
      plan: 'yearly',
      status: 'active',
      started_at: now.toISOString(),
      expires_at: oneYearLater,
      razorpay_payment_id: 'referral_grant',
    });
    if (insertErr) return res.status(400).json({ error: insertErr.message });
  } else if (sub.expires_at === null) {
    // Case 4: Lifetime — leave subscription unchanged, just mark referral
  } else if (sub.status === 'active' && sub.expires_at) {
    // Case 2: Active with expiry — extend by 1 year
    const newExpiry = new Date(sub.expires_at);
    newExpiry.setFullYear(newExpiry.getFullYear() + 1);
    const { error: updateErr } = await supabase
      .from('subscriptions')
      .update({ expires_at: newExpiry.toISOString() })
      .eq('user_id', referrerId);
    if (updateErr) return res.status(400).json({ error: updateErr.message });
  } else {
    // Case 3: Expired or cancelled — reactivate
    const { error: updateErr } = await supabase
      .from('subscriptions')
      .update({ status: 'active', started_at: now.toISOString(), expires_at: oneYearLater })
      .eq('user_id', referrerId);
    if (updateErr) return res.status(400).json({ error: updateErr.message });
  }

  // Update referral reward_status
  const newStatus = referral.reward_status === 'gift_card_added' ? 'fully_rewarded' : 'subscription_granted';
  const { error: refUpdateErr } = await supabase
    .from('referrals')
    .update({ reward_status: newStatus, subscription_granted_at: now.toISOString() })
    .eq('id', referral_id);

  if (refUpdateErr) return res.status(400).json({ error: refUpdateErr.message });
  res.json({ message: 'Subscription granted', reward_status: newStatus });
};

// POST /refer/admin/add-gift-card
exports.adminAddGiftCard = async (req, res) => {
  const { referral_id, gift_card_code } = req.body;
  if (!referral_id) return res.status(422).json({ error: 'referral_id is required' });
  if (!gift_card_code?.trim()) return res.status(422).json({ error: 'gift_card_code is required' });
  if (gift_card_code.trim().length > 64) {
    return res.status(422).json({ error: 'Gift card code must not exceed 64 characters' });
  }

  const { data: referral, error: refErr } = await supabase
    .from('referrals')
    .select('*')
    .eq('id', referral_id)
    .single();

  if (refErr || !referral) return res.status(404).json({ error: 'Referral not found' });
  if (referral.gift_card_added_at) {
    return res.status(400).json({ error: 'Gift card already added for this referral' });
  }

  const now = new Date().toISOString();
  const newStatus = referral.reward_status === 'subscription_granted' ? 'fully_rewarded' : 'gift_card_added';

  const { error: updateErr } = await supabase
    .from('referrals')
    .update({
      gift_card_code: gift_card_code.trim(),
      gift_card_added_at: now,
      reward_status: newStatus,
    })
    .eq('id', referral_id);

  if (updateErr) return res.status(400).json({ error: updateErr.message });
  res.json({ message: 'Gift card added', reward_status: newStatus });
};
