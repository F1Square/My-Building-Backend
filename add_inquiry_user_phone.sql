-- Run in Supabase SQL Editor
-- Adds mobile number on society / building registration inquiries
ALTER TABLE building_inquiries
  ADD COLUMN IF NOT EXISTS user_phone text;
