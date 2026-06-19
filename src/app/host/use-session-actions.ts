"use client";

import { useCallback, useState } from "react";

/**
 * Session lifecycle actions for the host console. Currently the "start a fresh
 * session" flow, which ends the current session, clears the live queue, and
 * snaps the UI back to a clean state via the injected resets (files view +
 * playback). Injects shared deps ({ authHeader, refresh, onError }) plus the
 * two cross-cluster resets so it doesn't reach into their internals.
 */
export function useSessionActions({
  authHeader,
  refresh,
  onError,
  resetFilesView,
  resetPlayback,
}: {
  authHeader: Record<string, string>;
  refresh: () => Promise<void> | void;
  onError: (message: string) => void;
  resetFilesView: () => void;
  resetPlayback: () => void;
}) {
  const [creatingSession, setCreatingSession] = useState(false);

  const createSession = useCallback(async () => {
    if (
      !window.confirm(
        "Start a fresh session? This ends the current session and clears the live queue. Past tracks stay available in Files."
      )
    ) {
      return;
    }
    setCreatingSession(true);
    try {
      const response = await fetch("/api/admin/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        onError(body?.message || "Could not start a new session.");
        return;
      }
      // Back to the active-session files view + cleared playback.
      resetFilesView();
      resetPlayback();
      await refresh();
    } catch {
      onError("Network error starting a new session.");
    } finally {
      setCreatingSession(false);
    }
  }, [authHeader, refresh, onError, resetFilesView, resetPlayback]);

  return { creatingSession, createSession };
}
