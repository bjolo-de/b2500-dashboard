-- Persisted daily rollups with a read-through cache.
-- Run from the Supabase SQL editor (Project → SQL → New query → paste → Run).
-- Idempotent: safe to re-run.
--
-- WHY THIS EXISTS
-- ───────────────
-- The `daily_aggregates` RPC (migration 0003) scans raw shelly/marstek rows
-- with window functions on every pageload. Measured on the free tier:
--
--     7 days  → 2.65 s      (barely under the limit — "weeks sometimes fail")
--    10 days  → 500 timeout
--    31 days  → 500 timeout
--
-- Supabase caps the `anon`/PostgREST role at a ~3 s statement_timeout — NOT
-- the 8 s that migration 0003's chunking assumed. A single 10-day chunk
-- already blows past 3 s, so the "chunk into 10-day windows" approach could
-- never have worked; the month view has always 500'd.
--
-- Fix: compute each calendar day ONCE, persist it, and serve completed days
-- straight from the table. A month view then reads ~31 pre-aggregated rows
-- (milliseconds) and recomputes only the in-progress day.

-- ─── Cache table ──────────────────────────────────────────────────────────
-- Keyed by (day, tz): day boundaries depend on the timezone, so the same
-- instant can land on different calendar days under different tz settings.
--
-- DROP + CREATE (not CREATE IF NOT EXISTS): this table holds only derived
-- cache rows that are cheaply regenerated from the raw readings, so a clean
-- rebuild is safe and guarantees the (day, tz) primary key that ON CONFLICT
-- below relies on.

DROP TABLE IF EXISTS daily_rollups;

CREATE TABLE daily_rollups (
  day                  date             NOT NULL,
  tz                   text             NOT NULL,
  pv_kwh               double precision NOT NULL DEFAULT 0,
  output_kwh           double precision NOT NULL DEFAULT 0,
  import_kwh           double precision NOT NULL DEFAULT 0,
  export_kwh           double precision NOT NULL DEFAULT 0,
  pv_to_battery_kwh    double precision NOT NULL DEFAULT 0,
  pv_to_home_kwh       double precision NOT NULL DEFAULT 0,
  battery_to_home_kwh  double precision NOT NULL DEFAULT 0,
  soc_min_pct          smallint,
  soc_max_pct          smallint,
  soc_end_pct          smallint,
  -- When this row was last computed. A row computed while its own day was
  -- still in progress (computed_at's tz-date <= day) is treated as stale and
  -- gets recomputed on the next read, which finalizes it after midnight.
  computed_at          timestamptz      NOT NULL DEFAULT NOW(),
  PRIMARY KEY (day, tz)
);

ALTER TABLE daily_rollups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_read ON daily_rollups;
CREATE POLICY anon_read ON daily_rollups
  FOR SELECT TO anon USING (true);

-- ─── Writer: (re)compute a range and upsert into the cache ────────────────
-- SECURITY DEFINER so it runs as the table owner, bypassing both RLS (anon
-- has no write policy) and the low anon statement_timeout. Delegates the
-- heavy math to daily_aggregates() so the trapezoidal logic lives in one
-- place. Returns the number of day-rows written.

CREATE OR REPLACE FUNCTION refresh_daily_rollups(
  from_ts timestamptz,
  to_ts   timestamptz,
  tz      text DEFAULT 'UTC'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '55s'
AS $$
-- Resolve ambiguous bare identifiers (e.g. `tz`) to the function's variable,
-- not a same-named table column.
#variable_conflict use_variable
DECLARE
  n integer;
BEGIN
  INSERT INTO daily_rollups AS r (
    day, tz,
    pv_kwh, output_kwh, import_kwh, export_kwh,
    pv_to_battery_kwh, pv_to_home_kwh, battery_to_home_kwh,
    soc_min_pct, soc_max_pct, soc_end_pct, computed_at
  )
  SELECT
    d.day, tz,
    d.pv_kwh, d.output_kwh, d.import_kwh, d.export_kwh,
    d.pv_to_battery_kwh, d.pv_to_home_kwh, d.battery_to_home_kwh,
    d.soc_min_pct, d.soc_max_pct, d.soc_end_pct, NOW()
  FROM daily_aggregates(from_ts, to_ts, tz) d
  -- Reference the primary key by name, not by column list: under
  -- `#variable_conflict use_variable` a bare `tz` in an ON CONFLICT column
  -- list gets substituted with the parameter value, which matches no index.
  ON CONFLICT ON CONSTRAINT daily_rollups_pkey DO UPDATE SET
    pv_kwh              = EXCLUDED.pv_kwh,
    output_kwh          = EXCLUDED.output_kwh,
    import_kwh          = EXCLUDED.import_kwh,
    export_kwh          = EXCLUDED.export_kwh,
    pv_to_battery_kwh   = EXCLUDED.pv_to_battery_kwh,
    pv_to_home_kwh      = EXCLUDED.pv_to_home_kwh,
    battery_to_home_kwh = EXCLUDED.battery_to_home_kwh,
    soc_min_pct         = EXCLUDED.soc_min_pct,
    soc_max_pct         = EXCLUDED.soc_max_pct,
    soc_end_pct         = EXCLUDED.soc_end_pct,
    computed_at         = NOW();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_daily_rollups(timestamptz, timestamptz, text) TO service_role;

-- ─── Read-through: ensure days are cached, then return them ───────────────
-- Same signature and row shape as daily_aggregates(), so the app can swap
-- one for the other. SECURITY DEFINER + a raised statement_timeout let anon
-- call it without hitting the 3 s cap; the heavy path (recomputing missing
-- days) runs at most once per day, then every read is a trivial index scan.

CREATE OR REPLACE FUNCTION daily_aggregates_cached(
  from_ts timestamptz,
  to_ts   timestamptz,
  tz      text DEFAULT 'UTC'
)
RETURNS TABLE (
  day                  date,
  pv_kwh               double precision,
  output_kwh           double precision,
  import_kwh           double precision,
  export_kwh           double precision,
  pv_to_battery_kwh    double precision,
  pv_to_home_kwh       double precision,
  battery_to_home_kwh  double precision,
  soc_min_pct          smallint,
  soc_max_pct          smallint,
  soc_end_pct          smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '55s'
AS $$
-- Resolve ambiguous bare identifiers (e.g. `tz`) to the function's variable,
-- not a same-named table column.
#variable_conflict use_variable
DECLARE
  day_lo date := (from_ts AT TIME ZONE tz)::date;
  day_hi date := (to_ts   AT TIME ZONE tz)::date;
  v_lo   date;
  v_hi   date;
BEGIN
  -- Which days in the range need (re)computing? A day qualifies if it is
  -- missing, or its cached row was only ever computed while that day was
  -- still in progress (never finalized after midnight).
  SELECT MIN(g.d)::date, MAX(g.d)::date
    INTO v_lo, v_hi
  FROM generate_series(day_lo, day_hi, interval '1 day') AS g(d)
  WHERE NOT EXISTS (
    SELECT 1 FROM daily_rollups r
    WHERE r.tz = tz
      AND r.day = g.d::date
      AND (r.computed_at AT TIME ZONE tz)::date > g.d::date
  );

  -- Recompute the smallest contiguous span covering those days. After a
  -- one-time backfill this is just today (and yesterday right after midnight).
  IF v_lo IS NOT NULL THEN
    PERFORM refresh_daily_rollups(
      (v_lo::text)::timestamp AT TIME ZONE tz,
      ((v_hi + 1)::text)::timestamp AT TIME ZONE tz - interval '1 millisecond',
      tz
    );
  END IF;

  RETURN QUERY
    SELECT
      r.day, r.pv_kwh, r.output_kwh, r.import_kwh, r.export_kwh,
      r.pv_to_battery_kwh, r.pv_to_home_kwh, r.battery_to_home_kwh,
      r.soc_min_pct, r.soc_max_pct, r.soc_end_pct
    FROM daily_rollups r
    WHERE r.tz = tz
      AND r.day BETWEEN day_lo AND day_hi
    ORDER BY r.day;
END;
$$;

GRANT EXECUTE ON FUNCTION daily_aggregates_cached(timestamptz, timestamptz, text) TO anon;
GRANT EXECUTE ON FUNCTION daily_aggregates_cached(timestamptz, timestamptz, text) TO service_role;
