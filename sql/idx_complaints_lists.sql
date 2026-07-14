-- Run once on Supabase (SQL editor) for complaints list performance.
-- Matches GET /complaints/building and GET /complaints/my ORDER BY created_at DESC.

CREATE INDEX IF NOT EXISTS idx_complaints_building_created
  ON complaints (building_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_complaints_user_created
  ON complaints (user_id, created_at DESC);
