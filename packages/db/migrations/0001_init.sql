-- Initial schema for b2500-dashboard.
-- Run from the Supabase SQL editor (Project → SQL → New query → paste → Run).
-- Idempotent: re-running drops nothing, only creates if missing.

-- ─── Live readings ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shelly_readings (
  ts        timestamptz PRIMARY KEY DEFAULT NOW(),
  total_w   double precision NOT NULL,            -- saldo: + import, - export
  a_w       double precision,
  b_w       double precision,
  c_w       double precision,
  raw       jsonb
);

CREATE INDEX IF NOT EXISTS shelly_readings_ts_desc
  ON shelly_readings (ts DESC);

CREATE TABLE IF NOT EXISTS marstek_readings (
  ts                          timestamptz PRIMARY KEY DEFAULT NOW(),
  battery_soc_pct             smallint,
  pv_input1_w                 double precision,
  pv_input2_w                 double precision,
  pv_total_w                  double precision,
  output1_w                   double precision,
  output2_w                   double precision,
  output_total_w              double precision,
  daily_pv_charge_wh          integer,
  daily_battery_charge_wh     integer,
  daily_battery_discharge_wh  integer,
  temp_min_c                  smallint,
  temp_max_c                  smallint,
  charge_alarm                boolean,
  discharge_alarm             boolean,
  raw                         jsonb
);

CREATE INDEX IF NOT EXISTS marstek_readings_ts_desc
  ON marstek_readings (ts DESC);

-- ─── Heartbeats ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_heartbeat (
  component  text PRIMARY KEY,
  last_seen  timestamptz NOT NULL DEFAULT NOW(),
  details    jsonb
);

-- ─── Daily summaries (populated by nightly job) ───────────────────────────

CREATE TABLE IF NOT EXISTS daily_summary (
  date                   date PRIMARY KEY,
  pv_total_kwh           double precision,
  grid_import_kwh        double precision,
  grid_export_kwh        double precision,
  battery_charge_kwh     double precision,
  battery_discharge_kwh  double precision,
  soc_min_pct            smallint,
  soc_max_pct            smallint,
  cost_saved_eur         double precision
);

-- ─── User settings ────────────────────────────────────────────────────────
-- Single-row table; the dashboard reads this at runtime so the user can
-- adjust tariff and feed-in rate without redeploying.

CREATE TABLE IF NOT EXISTS user_settings (
  id                    smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  energy_price_ct_kwh   numeric(6,3)  NOT NULL DEFAULT 26.93,
  base_fee_eur_month    numeric(6,2)  NOT NULL DEFAULT 8.41,
  feed_in_ct_kwh        numeric(6,3)  NOT NULL DEFAULT 0,
  timezone              text          NOT NULL DEFAULT 'Europe/Berlin',
  ntfy_topic            text,
  updated_at            timestamptz   NOT NULL DEFAULT NOW()
);

INSERT INTO user_settings (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- ─── Row Level Security ───────────────────────────────────────────────────
-- Anon role: read-only on everything.
-- Writes happen exclusively via service_role (held by fly.io stack and
-- Shelly Script) — service_role bypasses RLS by design.

ALTER TABLE shelly_readings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE marstek_readings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_heartbeat  ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_summary     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_read ON shelly_readings;
CREATE POLICY anon_read ON shelly_readings
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS anon_read ON marstek_readings;
CREATE POLICY anon_read ON marstek_readings
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS anon_read ON system_heartbeat;
CREATE POLICY anon_read ON system_heartbeat
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS anon_read ON daily_summary;
CREATE POLICY anon_read ON daily_summary
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS anon_read ON user_settings;
CREATE POLICY anon_read ON user_settings
  FOR SELECT TO anon USING (true);

-- ─── Retention helper ─────────────────────────────────────────────────────
-- Call from a daily Vercel cron after daily_summary is filled.
-- Keeps live tables small and within Supabase free tier.

CREATE OR REPLACE FUNCTION prune_live_data(retain_days int DEFAULT 90)
RETURNS void AS $$
BEGIN
  DELETE FROM shelly_readings  WHERE ts < NOW() - (retain_days || ' days')::interval;
  DELETE FROM marstek_readings WHERE ts < NOW() - (retain_days || ' days')::interval;
END;
$$ LANGUAGE plpgsql;
