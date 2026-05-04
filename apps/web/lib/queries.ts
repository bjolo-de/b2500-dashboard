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

export async function fetchShellyRange(from: Date, to: Date): Promise<ShellyRow[]> {
  const { data, error } = await supabase
    .from("shelly_readings")
    .select("ts, total_w, a_w, b_w, c_w")
    .gte("ts", from.toISOString())
    .lte("ts", to.toISOString())
    .order("ts", { ascending: true })
    .returns<ShellyRow[]>();
  if (error) throw error;
  return data ?? [];
}

export async function fetchMarstekRange(from: Date, to: Date): Promise<MarstekRow[]> {
  const { data, error } = await supabase
    .from("marstek_readings")
    .select("ts, battery_soc_pct, pv_total_w, pv_input1_w, pv_input2_w, output_total_w, daily_pv_charge_wh, daily_battery_charge_wh, daily_battery_discharge_wh, temp_min_c, temp_max_c, charge_alarm, discharge_alarm")
    .gte("ts", from.toISOString())
    .lte("ts", to.toISOString())
    .order("ts", { ascending: true })
    .returns<MarstekRow[]>();
  if (error) throw error;
  return data ?? [];
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
