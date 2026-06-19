"use client";

import { useCallback, useState } from "react";

/**
 * Stage orb colorway picker state for the host console: open/close, the
 * in-flight name, and the chooser that persists the selection. Injects shared
 * deps ({ current, authHeader, refresh, onError }) per the host-console
 * convention — POSTs then awaits refresh(); a no-op pick just closes.
 */
export function useOrbColorway({
  current,
  authHeader,
  refresh,
  onError,
}: {
  current: string;
  authHeader: Record<string, string>;
  refresh: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [orbPickerOpen, setOrbPickerOpen] = useState(false);
  const [settingOrb, setSettingOrb] = useState<string | null>(null);

  const chooseOrbColorway = useCallback(
    async (name: string) => {
      if (name === current) {
        setOrbPickerOpen(false);
        return;
      }
      setSettingOrb(name);
      try {
        const response = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ orbColorway: name }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          onError(body?.message || "Could not update the orb.");
          return;
        }
        await refresh();
        setOrbPickerOpen(false);
      } catch {
        onError("Network error updating the orb.");
      } finally {
        setSettingOrb(null);
      }
    },
    [authHeader, current, refresh, onError]
  );

  return { orbPickerOpen, setOrbPickerOpen, settingOrb, chooseOrbColorway };
}
