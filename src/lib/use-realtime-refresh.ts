"use client";

import { useEffect } from "react";

import { getBrowserSupabase } from "@/lib/supabase/browser";
import { REALTIME_TOPIC } from "@/lib/status";

export function useRealtimeRefresh(onRefresh: () => void, filterId?: string) {
  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      return;
    }

    const channel = supabase
      .channel(REALTIME_TOPIC)
      .on("broadcast", { event: "*" }, (payload) => {
        const changedId =
          typeof payload.payload === "object" &&
          payload.payload !== null &&
          "id" in payload.payload
            ? String(payload.payload.id)
            : null;

        if (!filterId || changedId === filterId) {
          onRefresh();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [filterId, onRefresh]);
}
