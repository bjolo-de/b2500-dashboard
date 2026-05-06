"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AggregatePeriod } from "@/lib/period";

type Props = {
  period: AggregatePeriod;
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
  const [pending, startTransition] = useTransition();

  function navigate(d: string | null) {
    const next = new URLSearchParams(params);
    next.set("p", period);
    if (d) next.set("d", d);
    else next.delete("d");
    startTransition(() => {
      router.push(`/?${next.toString()}`);
    });
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 text-sm text-ink-700 transition-opacity",
        pending && "opacity-70",
      )}
    >
      <button
        onClick={() => navigate(prevAnchorParam)}
        disabled={pending}
        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-900 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        aria-label="Vorheriger Zeitraum"
      >
        <ChevronLeft size={16} />
      </button>
      <button
        onClick={() => !isCurrent && navigate(null)}
        disabled={pending || isCurrent}
        className={cn(
          "min-w-[180px] rounded-full px-3 py-1 font-medium transition-colors flex items-center justify-center gap-1.5",
          isCurrent
            ? "text-ink-900"
            : "text-ink-700 hover:bg-ink-100 cursor-pointer",
        )}
        title={isCurrent ? "" : "Zum aktuellen Zeitraum springen"}
      >
        {pending ? <Loader2 size={12} className="animate-spin" /> : null}
        <span>{label}</span>
      </button>
      <button
        onClick={() => hasNext && navigate(nextAnchorParam)}
        disabled={!hasNext || pending}
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
