-- Add alert-state tracking to system_heartbeat so the Vercel health-check
-- cron can detect transitions (ok ↔ warn ↔ down) and send ntfy push only
-- on state change instead of on every check.

ALTER TABLE system_heartbeat
  ADD COLUMN IF NOT EXISTS last_alerted_severity text
    CHECK (last_alerted_severity IS NULL
           OR last_alerted_severity IN ('ok', 'warn', 'down')),
  ADD COLUMN IF NOT EXISTS last_alerted_at timestamptz;

-- Default known components to 'ok' so the first cron run after this
-- migration won't fire spurious "back online" notifications.
UPDATE system_heartbeat
   SET last_alerted_severity = 'ok',
       last_alerted_at = NOW()
 WHERE last_alerted_severity IS NULL
   AND last_seen > NOW() - interval '15 minutes';

-- Stash ntfy topic in user_settings so the cron route can read it from DB
-- (alternative would be env var, but keeping it user-editable).
-- Default = the random topic generated at install.
UPDATE user_settings SET ntfy_topic = 'b2500-mon-7g3kx9' WHERE id = 1 AND ntfy_topic IS NULL;
