"use client";

import { useTransition } from "react";
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
  const [pending, startTransition] = useTransition();

  function pick(key: string) {
    if (key === current) return;
    const next = new URLSearchParams(params);
    next.set("p", key);
    next.delete("d");  // reset date anchor when period changes
    startTransition(() => {
      router.push(`/?${next.toString()}`);
    });
  }

  return (
    <div
      className={cn(
        "inline-flex rounded-full bg-ink-100 p-1 text-sm transition-opacity",
        pending && "opacity-70",
      )}
    >
      {PERIODS.map((p) => (
        <button
          key={p.key}
          onClick={() => pick(p.key)}
          disabled={pending}
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
