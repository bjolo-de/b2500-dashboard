"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetches the server-rendered page tree every `intervalSec` seconds.
 * router.refresh() preserves client state (modals, scroll, hover) and only
 * re-runs Server Components, so the cost is one HTTP round-trip per cycle.
 */
export function AutoRefresh({ intervalSec = 30 }: { intervalSec?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalSec * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalSec]);
  return null;
}
