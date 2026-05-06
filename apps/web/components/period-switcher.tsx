"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const PERIODS = [
  { key: "live", label: "Live" },
  { key: "today", label: "Tag" },
  { key: "week", label: "Woche" },
  { key: "month", label: "Monat" },
] as const;

export function PeriodSwitcher() {
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get("p") ?? "live";
  const [pending, startTransition] = useTransition();

  function pick(key: string) {
    if (key === current) return;
    const next = new URLSearchParams(params);
    next.set("p", key);
    next.delete("d");
    startTransition(() => {
      router.push(`/?${next.toString()}`);
    });
  }

  return (
    <div className={cn("flex w-full justify-center transition-opacity", pending && "opacity-70")}>
      <div className="flex w-full max-w-md rounded-full bg-ink-100 p-1 text-sm sm:w-auto">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => pick(p.key)}
            disabled={pending}
            className={cn(
              "flex-1 rounded-full px-3 py-1.5 transition sm:flex-initial sm:px-4",
              current === p.key
                ? "bg-white text-ink-900 shadow-sm"
                : "text-ink-500 hover:text-ink-800",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
