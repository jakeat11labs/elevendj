"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { QueueSnapshot } from "@/lib/status";
import type { RoomPlaybackState } from "@/lib/playback/contracts";
import {
  computePlayingPositionMs,
  shouldSeekForDrift,
} from "@/lib/playback/timeline";

export type PlayerStateResponse = {
  device: {
    id: string;
    name: string;
    sessionId: string | null;
    audioUnlocked: boolean;
  };
  session: {
    id: string;
    name: string;
    roomName: string | null;
    publicCode: string;
    externalSessionId: string | null;
    /** Portal destination encoded in the room-screen request QR. */
    portalRequestUrl: string;
    isActive: boolean;
    masterVolume: number;
    orbColorway: string;
    requestsOpen: boolean;
  } | null;
  playback: RoomPlaybackState | null;
  queue: QueueSnapshot | null;
};

export function useRemotePlayback(opts: {
  enabled: boolean;
  audioUnlocked: boolean;
  onState: (state: PlayerStateResponse) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const onStateRef = useRef(opts.onState);
  useEffect(() => {
    onStateRef.current = opts.onState;
  }, [opts.onState]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/player/state", { cache: "no-store" });
      if (res.status === 401) {
        setError("unpaired");
        return null;
      }
      const body = (await res.json()) as PlayerStateResponse;
      if (!res.ok) {
        setError("Could not load player state.");
        return null;
      }
      setError(null);
      onStateRef.current(body);
      return body;
    } catch {
      setError("Network error reaching the player API.");
      return null;
    }
  }, []);

  useEffect(() => {
    if (!opts.enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [opts.enabled, refresh]);

  const report = useCallback(
    async (payload: {
      requestId: string | null;
      revision: number;
      isPlaying: boolean;
      positionMs: number;
      /** Explicit override for the one-shot user gesture that unlocks audio. */
      audioUnlocked?: boolean;
      error?: string | null;
    }) => {
      try {
        await fetch("/api/player/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            audioUnlocked: payload.audioUnlocked ?? opts.audioUnlocked,
          }),
        });
      } catch {
        /* best-effort */
      }
    },
    [opts.audioUnlocked]
  );

  const reportEnded = useCallback(
    async (trackId: string, expectedRevision: number) => {
      const key = `ended:${trackId}:${expectedRevision}`;
      try {
        await fetch("/api/player/playback", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify({
            action: "ended",
            trackId,
            expectedRevision,
          }),
        });
      } catch {
        /* best-effort; next poll will reconcile */
      }
    },
    []
  );

  return { refresh, report, reportEnded, error };
}

export { computePlayingPositionMs, shouldSeekForDrift };
