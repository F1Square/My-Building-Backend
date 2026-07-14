-- Speeds lookup: one referral per society registration (case-insensitive name match).
CREATE INDEX IF NOT EXISTS idx_referrals_society_name_lower
  ON referrals (lower(society_name))
  WHERE inquiry_id IS NOT NULL;
