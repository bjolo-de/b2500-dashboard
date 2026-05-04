// POST handler that updates the single-row user_settings.
// Uses the Supabase service-role key (server-only env), so RLS is bypassed.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!url) {
  console.warn("[api/settings] NEXT_PUBLIC_SUPABASE_URL missing");
}

export async function POST(req: Request) {
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server is missing SUPABASE_SERVICE_KEY env var" },
      { status: 500 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const energy = numOrUndef(body.energy_price_ct_kwh);
  const base = numOrUndef(body.base_fee_eur_month);
  const feedIn = numOrUndef(body.feed_in_ct_kwh);

  if (energy == null && base == null && feedIn == null) {
    return NextResponse.json({ error: "no editable fields provided" }, { status: 400 });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (energy != null) update.energy_price_ct_kwh = energy;
  if (base != null) update.base_fee_eur_month = base;
  if (feedIn != null) update.feed_in_ct_kwh = feedIn;

  const { error } = await supabase
    .from("user_settings")
    .update(update)
    .eq("id", 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidatePath("/");
  return NextResponse.json({ ok: true });
}

function numOrUndef(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
