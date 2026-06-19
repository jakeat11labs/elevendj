"use client";

import { useCallback, useState } from "react";

/**
 * ElevenLabs API-key management for the host console: the replace-key modal's
 * open state and the disconnect action. Injects shared deps
 * ({ authHeader, refresh, onError }) per the host-console convention — DELETE
 * then await refresh(). The needsKeySetup gate stays derived in the parent.
 */
export function useApiKeyManager({
  authHeader,
  refresh,
  onError,
}: {
  authHeader: Record<string, string>;
  refresh: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [removingKey, setRemovingKey] = useState(false);

  const removeApiKey = useCallback(async () => {
    if (
      !window.confirm(
        "Remove your ElevenLabs key? New tracks won't generate until you reconnect one."
      )
    ) {
      return;
    }
    setRemovingKey(true);
    try {
      const response = await fetch("/api/admin/api-key", {
        method: "DELETE",
        headers: authHeader,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        onError(body?.message || "Could not remove your key.");
        return;
      }
      await refresh();
    } catch {
      onError("Network error removing your key.");
    } finally {
      setRemovingKey(false);
    }
  }, [authHeader, refresh, onError]);

  return { apiKeyModalOpen, setApiKeyModalOpen, removingKey, removeApiKey };
}
