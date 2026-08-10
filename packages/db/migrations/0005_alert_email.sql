-- Alert email for the health-check cron. Stored in user_settings (editable
-- in the dashboard's tariff sheet) instead of a Vercel env var: the August
-- outage showed that an env var nobody remembers to set is not a channel.
-- ntfy.sh forwards each alert as an email via its "Email" header — mail
-- banners on iOS work regardless of the ntfy app's broken APNs delivery.
--
-- Run from the Supabase SQL editor. Idempotent.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS alert_email text;
