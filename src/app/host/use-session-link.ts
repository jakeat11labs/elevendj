"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Public request link state for the host's active session: keeps the link/QR in
 * sync with the session's public code, copies it to the clipboard (with a brief
 * "Copied" flash), and regenerates it. Follows the host-console convention of
 * injecting shared deps ({ publicCode, authHeader, refresh, onError }) rather
 * than owning canonical state — it POSTs then awaits refresh().
 */
export function useSessionLink({
  publicCode,
  authHeader,
  refresh,
  onError,
}: {
  publicCode: string | null | undefined;
  authHeader: Record<string, string>;
  refresh: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [requestLink, setRequestLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Keep the public request link + QR in sync with the active session's code.
  useEffect(() => {
    if (publicCode) {
      setRequestLink(`${window.location.origin}/request?code=${publicCode}`);
    } else {
      setRequestLink("");
    }
  }, [publicCode]);

  const copyLink = useCallback(() => {
    if (!requestLink) {
      return;
    }
    navigator.clipboard
      ?.writeText(requestLink)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => onError("Could not copy link."));
  }, [requestLink, onError]);

  const regenerateLink = useCallback(async () => {
    if (
      !window.confirm(
        "Generate a new request link? The current link and QR code will stop working immediately."
      )
    ) {
      return;
    }
    setRegenerating(true);
    try {
      const response = await fetch("/api/admin/sessions/regenerate", {
        method: "POST",
        headers: authHeader,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        onError(body?.message || "Could not regenerate the link.");
        return;
      }
      await refresh();
    } catch {
      onError("Network error regenerating the link.");
    } finally {
      setRegenerating(false);
    }
  }, [authHeader, refresh, onError]);

  return { requestLink, copied, copyLink, regenerating, regenerateLink };
}
