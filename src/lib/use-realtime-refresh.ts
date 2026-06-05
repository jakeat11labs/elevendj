"use client";

import { useEffect, useRef } from "react";

const DEFAULT_INTERVAL_MS = 2500;

/**
 * Polling-based live refresh (replaces Supabase Realtime, which left with the
 * Neon migration). Calls `onRefresh` on an interval, pausing while the tab is
 * hidden and firing once on return so the view catches up immediately.
 *
 * `filterId` is accepted for call-site compatibility but unused by polling.
 */
export function useRealtimeRefresh(
  onRefresh: () => void,
  filterId?: string,
  intervalMs: number = DEFAULT_INTERVAL_MS
) {
  const cb = useRef(onRefresh);

  useEffect(() => {
    cb.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    let timer: number | undefined;

    const tick = () => {
      if (document.visibilityState === "visible") {
        cb.current();
      }
    };

    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(tick, intervalMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        cb.current();
        start();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [filterId, intervalMs]);
}
