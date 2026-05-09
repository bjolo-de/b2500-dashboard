// Data access layer. All reads go through the anon-key Supabase client.
// Server-side only.

import { supabase } from "./supabase";

export type ShellyRow = {
  ts: string;
  total_w: number;
  a_w: number | null;
  b_w: number | null;
  c_w: number | null;
};

export type MarstekRow = {
  ts: string;
  battery_soc_pct: number | null;
  pv_total_w: number | null;
  pv_input1_w: number | null;
  pv_input2_w: number | null;
  output_total_w: number | null;
  daily_pv_charge_wh: number | null;
  daily_battery_charge_wh: number | null;
  daily_battery_discharge_wh: number | null;
  temp_min_c: number | null;
  temp_max_c: number | null;
  charge_alarm: boolean | null;
  discharge_alarm: boolean | null;
};

export type MarstekLatestRow = MarstekRow & {
  raw: Record<string, unknown> | null;
};

export type Heartbeat = {
  component: string;
  last_seen: string;
  details: Record<string, unknown> | null;
};

export type UserSettings = {
  energy_price_ct_kwh: number;
  base_fee_eur_month: number;
  feed_in_ct_kwh: number;
  timezone: string;
  ntfy_topic: string | null;
};

// One row per calendar day from the daily_aggregates RPC. All Wh-style
// values are pre-divided to kWh server-side; SOC is the smallint percent.
export type DailyAggregateRow = {
  day: string; // YYYY-MM-DD in the requested tz
  pv_kwh: number;
  output_kwh: number;
  import_kwh: number;
  export_kwh: number;
  pv_to_battery_kwh: number;
  pv_to_home_kwh: number;
  battery_to_home_kwh: number;
  soc_min_pct: number | null;
  soc_max_pct: number | null;
  soc_end_pct: number | null;
};

// Supabase Cloud free tier hard-caps result sets at 1000 rows per request.
// A week of 60s Shelly samples is ~10080 rows — 90% would be lost without
// pagination. We HEAD-count first, then fan out pages in parallel.
const PAGE_SIZE = 1000;

async function countInRange(
  table: "shelly_readings" | "marstek_readings",
  from: Date,
  to: Date,
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("ts", { head: true, count: "exact" })
    .gte("ts", from.toISOString())
    .lte("ts", to.toISOString());
  if (error) throw error;
  return count ?? 0;
}

async function fetchShellyPage(from: Date, to: Date, start: number, end: number): Promise<ShellyRow[]> {
  const { data, error } = await supabase
    .from("shelly_readings")
    .select("ts, total_w, a_w, b_w, c_w")
    .gte("ts", from.toISOString())
    .lte("ts", to.toISOString())
    .order("ts", { ascending: true })
    .range(start, end)
    .returns<ShellyRow[]>();
  if (error) throw error;
  return data ?? [];
}

async function fetchMarstekPage(from: Date, to: Date, start: number, end: number): Promise<MarstekRow[]> {
  const { data, error } = await supabase
    .from("marstek_readings")
    .select("ts, battery_soc_pct, pv_total_w, pv_input1_w, pv_input2_w, output_total_w, daily_pv_charge_wh, daily_battery_charge_wh, daily_battery_discharge_wh, temp_min_c, temp_max_c, charge_alarm, discharge_alarm")
    .gte("ts", from.toISOString())
    .lte("ts", to.toISOString())
    .order("ts", { ascending: true })
    .range(start, end)
    .returns<MarstekRow[]>();
  if (error) throw error;
  return data ?? [];
}

export async function fetchShellyRange(from: Date, to: Date): Promise<ShellyRow[]> {
  const total = await countInRange("shelly_readings", from, to);
  if (total === 0) return [];
  const pages = Math.ceil(total / PAGE_SIZE);
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      fetchShellyPage(from, to, i * PAGE_SIZE, (i + 1) * PAGE_SIZE - 1),
    ),
  );
  return results.flat();
}

export async function fetchMarstekRange(from: Date, to: Date): Promise<MarstekRow[]> {
  const total = await countInRange("marstek_readings", from, to);
  if (total === 0) return [];
  const pages = Math.ceil(total / PAGE_SIZE);
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      fetchMarstekPage(from, to, i * PAGE_SIZE, (i + 1) * PAGE_SIZE - 1),
    ),
  );
  return results.flat();
}

export async function fetchLatestShelly(): Promise<ShellyRow | null> {
  const { data, error } = await supabase
    .from("shelly_readings")
    .select("ts, total_w, a_w, b_w, c_w")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle()
    .returns<ShellyRow | null>();
  if (error) throw error;
  return data;
}

export async function fetchLatestMarstek(): Promise<MarstekLatestRow | null> {
  const { data, error } = await supabase
    .from("marstek_readings")
    .select("ts, battery_soc_pct, pv_total_w, pv_input1_w, pv_input2_w, output_total_w, daily_pv_charge_wh, daily_battery_charge_wh, daily_battery_discharge_wh, temp_min_c, temp_max_c, charge_alarm, discharge_alarm, raw")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle()
    .returns<MarstekLatestRow | null>();
  if (error) throw error;
  return data;
}

export async function fetchHeartbeats(): Promise<Heartbeat[]> {
  const { data, error } = await supabase
    .from("system_heartbeat")
    .select("component, last_seen, details")
    .order("component", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// Server-side daily rollup. Replaces fetchShellyRange + fetchMarstekRange
// for week/month views: one HTTP call returns ~7–31 pre-aggregated rows
// instead of fanning out tens of paginated reads to dump tens of thousands
// of raw samples.
export async function fetchDailyAggregates(
  from: Date,
  to: Date,
  tz: string = "UTC",
): Promise<DailyAggregateRow[]> {
  const { data, error } = await supabase.rpc("daily_aggregates", {
    from_ts: from.toISOString(),
    to_ts: to.toISOString(),
    tz,
  });
  if (error) throw error;
  return (data ?? []) as DailyAggregateRow[];
}

export async function fetchUserSettings(): Promise<UserSettings> {
  const { data, error } = await supabase
    .from("user_settings")
    .select(
      "energy_price_ct_kwh, base_fee_eur_month, feed_in_ct_kwh, timezone, ntfy_topic"
    )
    .eq("id", 1)
    .single();
  if (error) throw error;
  return data;
}
