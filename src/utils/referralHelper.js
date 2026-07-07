const supabase = require('../supabase');

class ReferralValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReferralValidationError';
    this.statusCode = 422;
  }
}

function normalizeReferralCode(code) {
  const trimmed = String(code || '').trim().toUpperCase().replace(/\s/g, '');
  if (!trimmed) return '';
  if (!/^[A-Z0-9]{4,12}$/.test(trimmed)) {
    throw new ReferralValidationError('Referral code must be 4–12 letters or digits');
  }
  return trimmed;
}

async function resolveReferrer(referralCode) {
  const code = normalizeReferralCode(referralCode);
  if (!code) return null;

  const { data: referrer } = await supabase
    .from('users')
    .select('id, email')
    .eq('referral_code', code)
    .maybeSingle();

  if (!referrer) throw new ReferralValidationError('Invalid referral code');
  return referrer;
}

function assertNotSelfReferral(referrer, { refereeUserId, refereeEmail }) {
  const email = refereeEmail?.trim().toLowerCase();
  if (refereeUserId && referrer.id === refereeUserId) {
    throw new ReferralValidationError('You cannot use your own referral code');
  }
  if (email && referrer.email?.toLowerCase() === email) {
    throw new ReferralValidationError('You cannot use your own referral code');
  }
}

/** Validate referral code before creating a society inquiry (no DB writes). */
async function validateReferralForInquiry({ referralCode, refereeUserId, refereeEmail }) {
  const referrer = await resolveReferrer(referralCode);
  if (!referrer) return;

  const normalizedEmail = refereeEmail.trim().toLowerCase();
  assertNotSelfReferral(referrer, { refereeUserId, refereeEmail: normalizedEmail });

  const { data: existing } = await supabase
    .from('referrals')
    .select('id')
    .eq('referee_email', normalizedEmail)
    .not('inquiry_id', 'is', null)
    .maybeSingle();

  if (existing) {
    throw new ReferralValidationError('A referral has already been applied for this email');
  }
}

/** Link a referral to a submitted society inquiry. */
async function applyReferralToInquiry({
  referralCode,
  refereeUserId,
  refereeEmail,
  refereeName,
  inquiryId,
  societyName,
}) {
  const referrer = await resolveReferrer(referralCode);
  if (!referrer) return;

  const normalizedEmail = refereeEmail.trim().toLowerCase();
  assertNotSelfReferral(referrer, { refereeUserId, refereeEmail: normalizedEmail });

  const { data: onInquiry } = await supabase
    .from('referrals')
    .select('id')
    .eq('inquiry_id', inquiryId)
    .maybeSingle();
  if (onInquiry) return;

  const { data: pending } = await supabase
    .from('referrals')
    .select('id')
    .eq('referee_email', normalizedEmail)
    .is('inquiry_id', null)
    .maybeSingle();

  if (pending) {
    const { error } = await supabase
      .from('referrals')
      .update({
        referrer_id: referrer.id,
        inquiry_id: inquiryId,
        society_name: societyName,
        referee_name: refereeName,
      })
      .eq('id', pending.id);
    if (error) throw error;
    return;
  }

  const { data: existing } = await supabase
    .from('referrals')
    .select('id')
    .eq('referee_email', normalizedEmail)
    .not('inquiry_id', 'is', null)
    .maybeSingle();

  if (existing) {
    throw new ReferralValidationError('A referral has already been applied for this email');
  }

  const { error } = await supabase.from('referrals').insert({
    referrer_id: referrer.id,
    inquiry_id: inquiryId,
    referee_name: refereeName,
    referee_email: normalizedEmail,
    society_name: societyName,
  });
  if (error) throw error;
}

module.exports = {
  ReferralValidationError,
  normalizeReferralCode,
  validateReferralForInquiry,
  applyReferralToInquiry,
};
