-- Run in Supabase SQL Editor
-- Mobile number on website "Get in touch" contact form
ALTER TABLE website_contacts
  ADD COLUMN IF NOT EXISTS phone text;
