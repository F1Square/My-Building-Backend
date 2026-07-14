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

function normalizeSocietyName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

async function resolveReferrer(referralCode) {
  const code = normalizeReferralCode(referralCode);
  if (!code) return null;

  const { data: referrer } = await supabase
    .from('users')
    .select('id, email, building_id')
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

/** Members of the same society cannot use each other's referral codes. */
async function assertNotSameSocietyMember(referrer, refereeUserId) {
  if (!refereeUserId || !referrer.building_id) return;

  const { data: referee } = await supabase
    .from('users')
    .select('building_id')
    .eq('id', refereeUserId)
    .maybeSingle();

  if (referee?.building_id && referee.building_id === referrer.building_id) {
    throw new ReferralValidationError(
      'Members of the same society cannot use each other’s referral codes',
    );
  }
}

/**
 * Only one referral may be credited for a given society registration
 * (case-insensitive society name, once linked to an inquiry).
 */
async function assertSocietyNotAlreadyReferred(societyName, { excludeInquiryId } = {}) {
  const name = normalizeSocietyName(societyName);
  if (!name) return;

  let query = supabase
    .from('referrals')
    .select('id, inquiry_id')
    .ilike('society_name', name)
    .not('inquiry_id', 'is', null)
    .limit(2);

  const { data: rows, error } = await query;
  if (error) throw error;

  const conflict = (rows || []).find((r) => r.inquiry_id !== excludeInquiryId);
  if (conflict) {
    throw new ReferralValidationError(
      'A referral has already been applied for this society registration',
    );
  }
}

/** Validate referral code before creating a society inquiry (no DB writes). */
async function validateReferralForInquiry({
  referralCode,
  refereeUserId,
  refereeEmail,
  societyName,
}) {
  const referrer = await resolveReferrer(referralCode);
  if (!referrer) return;

  const normalizedEmail = refereeEmail.trim().toLowerCase();
  assertNotSelfReferral(referrer, { refereeUserId, refereeEmail: normalizedEmail });
  await assertNotSameSocietyMember(referrer, refereeUserId);
  await assertSocietyNotAlreadyReferred(societyName);

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
  const normalizedSociety = normalizeSocietyName(societyName);

  assertNotSelfReferral(referrer, { refereeUserId, refereeEmail: normalizedEmail });
  await assertNotSameSocietyMember(referrer, refereeUserId);
  await assertSocietyNotAlreadyReferred(normalizedSociety, { excludeInquiryId: inquiryId });

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
        society_name: normalizedSociety,
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
    society_name: normalizedSociety,
  });
  if (error) throw error;
}

module.exports = {
  ReferralValidationError,
  normalizeReferralCode,
  validateReferralForInquiry,
  applyReferralToInquiry,
};
