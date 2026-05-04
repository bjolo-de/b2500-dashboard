// Period + anchor model.
//
// "Period" = today | week | month — the granularity of view.
// "Anchor" = a Date that pins which specific day/week/month is shown.
// URL param `d` encodes the anchor:
//   today → YYYY-MM-DD
//   week  → YYYY-Www  (ISO week, e.g. "2026-W17")
//   month → YYYY-MM
//
// `isCurrent` distinguishes "current period (live)" from "past period
// (purely aggregate)" — the diagram switches mode based on this.

import {
  addDays, addMonths, addWeeks,
  endOfDay, endOfMonth, endOfWeek,
  format, getISOWeek, getISOWeekYear, parse, parseISO,
  startOfDay, startOfMonth, startOfWeek,
} from "date-fns";
import { de } from "date-fns/locale";

export type Period = "today" | "week" | "month";

export type Range = {
  from: Date;
  to: Date;
  label: string;        // long label, e.g. "Sonntag, 4. Mai 2026"
  shortLabel: string;   // for the navigator pill
  isCurrent: boolean;   // anchor falls within current real-time period
  anchorParam: string;  // URL serialisation
  prevAnchor: Date;
  nextAnchor: Date;
  hasNext: boolean;     // false when anchor === current period
};

const WEEK_OPTS = { weekStartsOn: 1 as const };  // ISO: Monday

export function parseAnchor(period: Period, dParam: string | undefined): Date {
  if (!dParam) return new Date();
  try {
    if (period === "today") {
      const d = parseISO(dParam);
      if (!isNaN(d.getTime())) return d;
    } else if (period === "week") {
      // "YYYY-Www" → Monday of that ISO week
      const m = /^(\d{4})-W(\d{1,2})$/.exec(dParam);
      if (m) {
        const year = Number(m[1]);
        const wk = Number(m[2]);
        // Jan 4 is always in ISO week 1
        const jan4 = new Date(year, 0, 4);
        const wk1Start = startOfWeek(jan4, WEEK_OPTS);
        return addWeeks(wk1Start, wk - 1);
      }
    } else if (period === "month") {
      const m = /^(\d{4})-(\d{2})$/.exec(dParam);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1);
    }
  } catch {
    // fall through
  }
  return new Date();
}

export function rangeFor(period: Period, anchor: Date): Range {
  const now = new Date();
  switch (period) {
    case "today": {
      const from = startOfDay(anchor);
      const to = endOfDay(anchor);
      const isCurrent =
        from.getTime() === startOfDay(now).getTime();
      const anchorParam = format(anchor, "yyyy-MM-dd");
      return {
        from,
        to,
        label: format(anchor, "EEEE, d. MMMM yyyy", { locale: de }),
        shortLabel: format(anchor, "d. MMM yyyy", { locale: de }),
        isCurrent,
        anchorParam,
        prevAnchor: addDays(from, -1),
        nextAnchor: addDays(from, 1),
        hasNext: !isCurrent,
      };
    }
    case "week": {
      const from = startOfWeek(anchor, WEEK_OPTS);
      const to = endOfWeek(anchor, WEEK_OPTS);
      const isCurrent =
        from.getTime() === startOfWeek(now, WEEK_OPTS).getTime();
      const wk = getISOWeek(anchor);
      const wkYear = getISOWeekYear(anchor);
      const anchorParam = `${wkYear}-W${String(wk).padStart(2, "0")}`;
      const sat = addDays(from, 6);
      return {
        from,
        to,
        label: `KW ${wk} · ${format(from, "d. MMM", { locale: de })} – ${format(sat, "d. MMM yyyy", { locale: de })}`,
        shortLabel: `KW ${wk} / ${wkYear}`,
        isCurrent,
        anchorParam,
        prevAnchor: addWeeks(from, -1),
        nextAnchor: addWeeks(from, 1),
        hasNext: !isCurrent,
      };
    }
    case "month": {
      const from = startOfMonth(anchor);
      const to = endOfMonth(anchor);
      const isCurrent =
        from.getTime() === startOfMonth(now).getTime();
      const anchorParam = format(anchor, "yyyy-MM");
      return {
        from,
        to,
        label: format(anchor, "MMMM yyyy", { locale: de }),
        shortLabel: format(anchor, "MMMM yyyy", { locale: de }),
        isCurrent,
        anchorParam,
        prevAnchor: addMonths(from, -1),
        nextAnchor: addMonths(from, 1),
        hasNext: !isCurrent,
      };
    }
  }
}

export function formatAnchorParam(period: Period, anchor: Date): string {
  return rangeFor(period, anchor).anchorParam;
}
