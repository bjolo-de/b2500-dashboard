// Daily-rollup cron handler — curled once a day, just after local midnight,
// by the Oracle VM crontab (same trigger pattern as /api/health-check; Vercel
// Hobby caps cron at daily so scheduling lives on the always-free VM).
//
// Finalizes the day that just ended: recomputes [yesterday 00:00 .. now] in
// the user's timezone and upserts it into daily_rollups. Yesterday becomes a
// complete, cached row so nobody ever pays the ~5 s live recompute for it.
//
// This is an optimization, not a correctness requirement: daily_aggregates_cached
// already self-heals stale days on read. The cron just pre-warms the cache at
// the day boundary.
//
// Authentication: mirrors /api/health-check. If CRON_SECRET is set, require it.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { TZDate } from "@date-fns/tz";
import { startOfDay, subDays } from "date-fns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY!;
  if (!url || !key) {
    return NextResponse.json({ error: "supabase config missing" }, { status: 500 });
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Timezone drives the day boundaries — read it from settings so the rollup
  // day matches what the dashboard shows.
  const { data: settings } = await supabase
    .from("user_settings")
    .select("timezone")
    .eq("id", 1)
    .single();
  const tz = settings?.timezone ?? "Europe/Berlin";

  // [start of yesterday .. now] in tz: finalizes yesterday, refreshes today.
  const now = new TZDate(Date.now(), tz);
  const from = startOfDay(subDays(now, 1));

  const { data, error } = await supabase.rpc("refresh_daily_rollups", {
    from_ts: from.toISOString(),
    to_ts: now.toISOString(),
    tz,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ranAt: now.toISOString(),
    tz,
    from: from.toISOString(),
    to: now.toISOString(),
    rowsWritten: data ?? null,
  });
}
