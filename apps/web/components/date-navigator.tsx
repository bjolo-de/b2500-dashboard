"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Period } from "@/lib/period";

type Props = {
  period: Period;
  label: string;
  prevAnchorParam: string;
  nextAnchorParam: string;
  hasNext: boolean;
  isCurrent: boolean;
};

export function DateNavigator({
  period,
  label,
  prevAnchorParam,
  nextAnchorParam,
  hasNext,
  isCurrent,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();

  function navigate(d: string | null) {
    const next = new URLSearchParams(params);
    next.set("p", period);
    if (d) next.set("d", d);
    else next.delete("d");
    router.push(`/?${next.toString()}`);
  }

  return (
    <div className="flex items-center justify-center gap-2 text-sm text-ink-700">
      <button
        onClick={() => navigate(prevAnchorParam)}
        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-900"
        aria-label="Vorheriger Zeitraum"
      >
        <ChevronLeft size={16} />
      </button>
      <button
        onClick={() => navigate(null)}
        className={cn(
          "min-w-[180px] rounded-full px-3 py-1 font-medium transition-colors",
          isCurrent
            ? "text-ink-900"
            : "text-ink-700 hover:bg-ink-100",
        )}
        title={isCurrent ? "" : "Zum aktuellen Zeitraum springen"}
      >
        {label}
      </button>
      <button
        onClick={() => hasNext && navigate(nextAnchorParam)}
        disabled={!hasNext}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full",
          hasNext
            ? "text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            : "text-ink-300 cursor-not-allowed",
        )}
        aria-label="Nächster Zeitraum"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
