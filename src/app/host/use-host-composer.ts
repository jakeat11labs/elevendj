"use client";

import { useCallback, useEffect, useState } from "react";

import type { QueueItem } from "@/lib/status";

/**
 * DJ-booth composer state machine: the prompt/name/instrumental/ideas inputs,
 * the host-authored submit, and the in-flight job poll that drives the live
 * progress stepper (queued → generating → ready, then auto-dismiss). Injects
 * shared deps ({ authHeader, refresh, onError }); the host endpoint queues
 * immediately (no approval/rate-limit gate). All composer-derived values are
 * computed here and returned for <DjBooth>.
 */
export function useHostComposer({
  authHeader,
  refresh,
  onError,
}: {
  authHeader: Record<string, string>;
  refresh: () => Promise<void> | void;
  onError: (message: string | null) => void;
}) {
  const [hostPrompt, setHostPrompt] = useState("");
  const [hostName, setHostName] = useState("Host");
  const [hostInstrumental, setHostInstrumental] = useState(false);
  const [hostIdeasOpen, setHostIdeasOpen] = useState(false);
  const [hostSubmitting, setHostSubmitting] = useState(false);
  // In-flight host-authored track: tracks the submission so we can show live
  // generation progress under the composer until it lands in the queue.
  const [hostJob, setHostJob] = useState<{
    requestId: string;
    clientToken: string;
  } | null>(null);
  const [hostJobItem, setHostJobItem] = useState<QueueItem | null>(null);

  // Host-authored request hits the admin-only endpoint, which skips the public
  // open/rate-limit gates and queues immediately (no approval step).
  const submitHostPrompt = useCallback(async () => {
    const prompt = hostPrompt.trim();
    if (prompt.length < 10 || hostSubmitting) {
      return;
    }
    setHostSubmitting(true);
    onError(null);
    try {
      const response = await fetch("/api/admin/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          prompt,
          requesterName: hostName.trim() || "Host",
          instrumental: hostInstrumental,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        onError(body?.message || "Could not add your track.");
        return;
      }
      setHostPrompt("");
      if (body?.requestId && body?.clientToken) {
        setHostJobItem(null);
        setHostJob({ requestId: body.requestId, clientToken: body.clientToken });
      }
      await refresh();
    } catch {
      onError("Network error sending your track.");
    } finally {
      setHostSubmitting(false);
    }
  }, [authHeader, hostInstrumental, hostName, hostPrompt, hostSubmitting, refresh, onError]);

  // Poll the in-flight host track's status so the composer can show live
  // progress (queued → generating → ready), then auto-dismiss once it lands.
  useEffect(() => {
    if (!hostJob) {
      return;
    }
    let cancelled = false;
    let hideTimer: number | undefined;

    async function poll() {
      try {
        const res = await fetch(
          `/api/requests/${hostJob!.requestId}?token=${encodeURIComponent(
            hostJob!.clientToken
          )}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) {
          return;
        }
        const item = (await res.json()) as QueueItem;
        if (cancelled) {
          return;
        }
        setHostJobItem(item);
        const terminal =
          item.status === "ready" ||
          item.status === "played" ||
          item.status === "archived" ||
          item.status === "failed" ||
          item.status === "rejected";
        if (terminal) {
          window.clearInterval(interval);
          hideTimer = window.setTimeout(() => {
            if (!cancelled) {
              setHostJob(null);
              setHostJobItem(null);
            }
          }, 6000);
        }
      } catch {
        /* keep last known state, try again next tick */
      }
    }

    const interval = window.setInterval(poll, 3000);
    poll();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (hideTimer) {
        window.clearTimeout(hideTimer);
      }
    };
  }, [hostJob]);

  const hostRemaining = 800 - hostPrompt.length;
  const hostTrimmed = hostPrompt.trim();
  const canHostSubmit =
    hostTrimmed.length >= 10 && hostRemaining >= 0 && !hostSubmitting;

  // Live progress for the host's in-flight track (null when nothing is cooking).
  const hostJobStatus = hostJobItem?.status;
  const hostJobFailed =
    hostJobStatus === "failed" || hostJobStatus === "rejected";
  const hostJobDone =
    hostJobStatus === "ready" ||
    hostJobStatus === "played" ||
    hostJobStatus === "archived";
  const hostJobStep = hostJobFailed
    ? -1
    : hostJobStatus === "generating"
      ? 1
      : hostJobDone
        ? 2
        : 0;
  const hostJobMessage = !hostJobItem
    ? "Sending your track…"
    : hostJobFailed
      ? hostJobItem.promptSuggestion ||
        hostJobItem.errorMessage ||
        "That track couldn’t be generated."
      : hostJobDone
        ? "Song finished and added to the queue."
        : hostJobStatus === "generating"
          ? "Generating your track now…"
          : "Queued — generating shortly…";

  return {
    hostPrompt,
    setHostPrompt,
    hostName,
    setHostName,
    hostInstrumental,
    setHostInstrumental,
    hostIdeasOpen,
    setHostIdeasOpen,
    hostSubmitting,
    canHostSubmit,
    submitHostPrompt,
    hostJob,
    hostRemaining,
    hostTrimmed,
    hostJobFailed,
    hostJobDone,
    hostJobStep,
    hostJobMessage,
  };
}
