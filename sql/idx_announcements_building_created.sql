  -- Run once on Supabase (SQL editor) if announcements list is slow under load.
  -- Matches GET /announcements filtered by building_id, ordered by created_at DESC.

  CREATE INDEX IF NOT EXISTS idx_announcements_building_created
    ON announcements (building_id, created_at DESC);
