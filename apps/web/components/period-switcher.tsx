"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const PERIODS = [
  { key: "today", label: "Heute" },
  { key: "week", label: "Woche" },
  { key: "month", label: "Monat" },
] as const;

export function PeriodSwitcher() {
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get("p") ?? "today";

  return (
    <div className="inline-flex rounded-full bg-ink-100 p-1 text-sm">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set("p", p.key);
            router.push(`/?${next.toString()}`);
          }}
          className={cn(
            "rounded-full px-3 py-1 transition",
            current === p.key
              ? "bg-white text-ink-900 shadow-sm"
              : "text-ink-500 hover:text-ink-800",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
