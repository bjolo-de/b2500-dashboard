-- Server-side daily rollup for the Verlauf views.
-- Replaces the per-row download for week/month: collapses ~10k–43k row reads
-- and ~88 paginated requests per pageload into a single RPC call.
--
-- Trapezoidal integration mirrors lib/aggregates.ts:
--   * pairs of rows separated by > 600 s are treated as offline gaps and skipped
--   * each pair's contribution is attributed to the calendar day of the cur (later) row
--
-- Day boundaries use the supplied tz (default 'UTC') so the caller can pick
-- between server-tz behaviour (matches the legacy aggregateByDay) and the
-- user's local-tz buckets without a schema change.

CREATE OR REPLACE FUNCTION daily_aggregates(
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
LANGUAGE sql
STABLE
AS $$
  WITH
  s AS (
    SELECT
      (ts AT TIME ZONE tz)::date                                AS day,
      ts,
      total_w,
      EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (ORDER BY ts)))     AS dt_s,
      LAG(total_w) OVER (ORDER BY ts)                           AS prev_total_w
    FROM shelly_readings
    WHERE ts >= from_ts AND ts <= to_ts
  ),
  s_daily AS (
    SELECT
      day,
      SUM(GREATEST(((prev_total_w + total_w) / 2.0) * dt_s / 3600.0, 0))
        FILTER (WHERE dt_s > 0 AND dt_s <= 600)                 AS import_wh,
      SUM(GREATEST(-((prev_total_w + total_w) / 2.0) * dt_s / 3600.0, 0))
        FILTER (WHERE dt_s > 0 AND dt_s <= 600)                 AS export_wh
    FROM s
    GROUP BY day
  ),
  m AS (
    SELECT
      (ts AT TIME ZONE tz)::date                                AS day,
      ts,
      pv_total_w,
      output_total_w,
      battery_soc_pct,
      EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (ORDER BY ts)))     AS dt_s,
      LAG(pv_total_w) OVER (ORDER BY ts)                        AS prev_pv,
      LAG(output_total_w) OVER (ORDER BY ts)                    AS prev_out
    FROM marstek_readings
    WHERE ts >= from_ts AND ts <= to_ts
  ),
  m_daily AS (
    SELECT
      day,
      -- positive integral of pv_total_w (matches integrate(...).pos)
      SUM(GREATEST(((COALESCE(prev_pv, 0) + COALESCE(pv_total_w, 0)) / 2.0) * dt_s / 3600.0, 0))
        FILTER (WHERE dt_s > 0 AND dt_s <= 600)                 AS pv_wh,
      SUM(GREATEST(((COALESCE(prev_out, 0) + COALESCE(output_total_w, 0)) / 2.0) * dt_s / 3600.0, 0))
        FILTER (WHERE dt_s > 0 AND dt_s <= 600)                 AS output_wh,
      -- directional: pv → battery (pv minus output, clamped at 0)
      SUM(((GREATEST(COALESCE(prev_pv, 0) - COALESCE(prev_out, 0), 0)
          + GREATEST(COALESCE(pv_total_w, 0) - COALESCE(output_total_w, 0), 0)) / 2.0) * dt_s / 3600.0)
        FILTER (WHERE dt_s > 0 AND dt_s <= 600)                 AS pv_to_battery_wh,
      -- directional: battery → home (output minus pv, clamped at 0)
      SUM(((GREATEST(COALESCE(prev_out, 0) - COALESCE(prev_pv, 0), 0)
          + GREATEST(COALESCE(output_total_w, 0) - COALESCE(pv_total_w, 0), 0)) / 2.0) * dt_s / 3600.0)
        FILTER (WHERE dt_s > 0 AND dt_s <= 600)                 AS battery_to_home_wh,
      -- pv → home directly (min of pv and output, both clamped at 0 via COALESCE)
      SUM(((LEAST(COALESCE(prev_pv, 0), COALESCE(prev_out, 0))
          + LEAST(COALESCE(pv_total_w, 0), COALESCE(output_total_w, 0))) / 2.0) * dt_s / 3600.0)
        FILTER (WHERE dt_s > 0 AND dt_s <= 600)                 AS pv_to_home_wh,
      MIN(battery_soc_pct)                                      AS soc_min,
      MAX(battery_soc_pct)                                      AS soc_max,
      (ARRAY_AGG(battery_soc_pct ORDER BY ts DESC)
         FILTER (WHERE battery_soc_pct IS NOT NULL))[1]         AS soc_end
    FROM m
    GROUP BY day
  )
  SELECT
    COALESCE(s_daily.day, m_daily.day)                           AS day,
    COALESCE(m_daily.pv_wh / 1000.0, 0)::double precision        AS pv_kwh,
    COALESCE(m_daily.output_wh / 1000.0, 0)::double precision    AS output_kwh,
    COALESCE(s_daily.import_wh / 1000.0, 0)::double precision    AS import_kwh,
    COALESCE(s_daily.export_wh / 1000.0, 0)::double precision    AS export_kwh,
    COALESCE(m_daily.pv_to_battery_wh / 1000.0, 0)::double precision    AS pv_to_battery_kwh,
    COALESCE(m_daily.pv_to_home_wh / 1000.0, 0)::double precision       AS pv_to_home_kwh,
    COALESCE(m_daily.battery_to_home_wh / 1000.0, 0)::double precision  AS battery_to_home_kwh,
    m_daily.soc_min                                              AS soc_min_pct,
    m_daily.soc_max                                              AS soc_max_pct,
    m_daily.soc_end                                              AS soc_end_pct
  FROM s_daily
  FULL OUTER JOIN m_daily ON s_daily.day = m_daily.day
  ORDER BY day;
$$;

GRANT EXECUTE ON FUNCTION daily_aggregates(timestamptz, timestamptz, text) TO anon;
