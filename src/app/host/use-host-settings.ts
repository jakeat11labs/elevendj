"use client";

import { useCallback, useState } from "react";

/**
 * Host session settings: the request-line / AutoDJ / Station-ID / crossfade
 * toggles, the Station-ID personalization name, and the room master volume.
 * Each writes to /api/admin/settings then awaits refresh() (no optimistic
 * state) except master volume, which holds a local `pendingVolume` so the
 * slider stays responsive while dragging. The current values are injected (the
 * toggles flip them) so the hook stays decoupled from the Overview shape.
 */
export function useHostSettings({
  requestsOpen,
  autoApprove,
  autoDjEnabled,
  autoDjBrief,
  stationIdEnabled,
  crossfadeEnabled,
  stationIdPersonalize,
  stationIdHostName,
  serverMasterVolume,
  authHeader,
  refresh,
  onError,
}: {
  requestsOpen: boolean;
  autoApprove: boolean;
  autoDjEnabled: boolean;
  autoDjBrief: string;
  stationIdEnabled: boolean;
  crossfadeEnabled: boolean;
  stationIdPersonalize: boolean;
  stationIdHostName: string;
  serverMasterVolume: number;
  authHeader: Record<string, string>;
  refresh: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [togglingRequests, setTogglingRequests] = useState(false);
  const [togglingAutoApprove, setTogglingAutoApprove] = useState(false);
  const [togglingAutoDj, setTogglingAutoDj] = useState(false);
  const [savingAutoDjBrief, setSavingAutoDjBrief] = useState(false);
  const [togglingStationId, setTogglingStationId] = useState(false);
  const [togglingCrossfade, setTogglingCrossfade] = useState(false);
  const [savingStationName, setSavingStationName] = useState(false);

  const toggleRequests = useCallback(async () => {
    const next = !requestsOpen;
    setTogglingRequests(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ requestsOpen: next }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        onError(body?.message || "Could not update the request line.");
        return;
      }
      await refresh();
    } catch {
      onError("Network error updating the request line.");
    } finally {
      setTogglingRequests(false);
    }
  }, [authHeader, refresh, onError, requestsOpen]);

  const toggleAutoApprove = useCallback(async () => {
    const next = !autoApprove;
    setTogglingAutoApprove(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ autoApprove: next }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        onError(body?.message || "Could not update auto-approve.");
        return;
      }
      await refresh();
    } catch {
      onError("Network error updating auto-approve.");
    } finally {
      setTogglingAutoApprove(false);
    }
  }, [authHeader, refresh, onError, autoApprove]);

  const toggleAutoDj = useCallback(async () => {
    const next = !autoDjEnabled;
    setTogglingAutoDj(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ autoDjEnabled: next }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        onError(body?.message || "Could not update AutoDJ.");
        return;
      }
      await refresh();
    } catch {
      onError("Network error updating AutoDJ.");
    } finally {
      setTogglingAutoDj(false);
    }
  }, [authHeader, refresh, onError, autoDjEnabled]);

  const saveAutoDjBrief = useCallback(
    async (value: string) => {
      if (value === autoDjBrief) {
        return; // unchanged — skip the round-trip
      }
      setSavingAutoDjBrief(true);
      try {
        const response = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ autoDjBrief: value }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          onError(body?.message || "Could not save the AutoDJ brief.");
          return;
        }
        await refresh();
      } catch {
        onError("Network error saving the AutoDJ brief.");
      } finally {
        setSavingAutoDjBrief(false);
      }
    },
    [authHeader, refresh, onError, autoDjBrief]
  );

  const toggleStationId = useCallback(async () => {
    const next = !stationIdEnabled;
    setTogglingStationId(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ stationIdEnabled: next }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        onError(body?.message || "Could not update Station ID.");
        return;
      }
      await refresh();
    } catch {
      onError("Network error updating Station ID.");
    } finally {
      setTogglingStationId(false);
    }
  }, [authHeader, refresh, onError, stationIdEnabled]);

  const toggleCrossfade = useCallback(async () => {
    const next = !crossfadeEnabled;
    setTogglingCrossfade(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ crossfadeEnabled: next }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        onError(body?.message || "Could not update crossfade.");
        return;
      }
      await refresh();
    } catch {
      onError("Network error updating crossfade.");
    } finally {
      setTogglingCrossfade(false);
    }
  }, [authHeader, refresh, onError, crossfadeEnabled]);

  const toggleStationIdPersonalize = useCallback(async () => {
    const next = !stationIdPersonalize;
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ stationIdPersonalize: next }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        onError(body?.message || "Could not update Station ID name.");
        return;
      }
      await refresh();
    } catch {
      onError("Network error updating Station ID name.");
    }
  }, [authHeader, refresh, onError, stationIdPersonalize]);

  const saveStationIdHostName = useCallback(
    async (value: string) => {
      if (value === stationIdHostName) {
        return; // unchanged — skip the round-trip
      }
      setSavingStationName(true);
      try {
        const response = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ stationIdHostName: value }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          onError(body?.message || "Could not save the Station ID name.");
          return;
        }
        await refresh();
      } catch {
        onError("Network error saving the Station ID name.");
      } finally {
        setSavingStationName(false);
      }
    },
    [authHeader, refresh, onError, stationIdHostName]
  );

  // While dragging we hold a local value so the slider stays responsive; the
  // committed value is POSTed on release and the snapshot becomes the source of
  // truth again (pending cleared). The stage screen obeys it on its next poll.
  const [pendingVolume, setPendingVolume] = useState<number | null>(null);
  const commitMasterVolume = useCallback(
    async (value: number) => {
      const clamped = Math.min(1, Math.max(0, value));
      try {
        const response = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ masterVolume: clamped }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          onError(body?.message || "Could not update the volume.");
          return;
        }
        await refresh();
      } catch {
        onError("Network error updating the volume.");
      } finally {
        setPendingVolume(null);
      }
    },
    [authHeader, refresh, onError]
  );

  // Live master volume — the pending drag value wins while the slider is held.
  const masterVolume = pendingVolume ?? serverMasterVolume;
  const masterVolumePct = Math.round(masterVolume * 100);

  return {
    toggleRequests,
    toggleAutoApprove,
    toggleAutoDj,
    saveAutoDjBrief,
    toggleStationId,
    toggleCrossfade,
    toggleStationIdPersonalize,
    saveStationIdHostName,
    commitMasterVolume,
    setPendingVolume,
    togglingRequests,
    togglingAutoApprove,
    togglingAutoDj,
    savingAutoDjBrief,
    togglingStationId,
    togglingCrossfade,
    savingStationName,
    masterVolume,
    masterVolumePct,
  };
}
