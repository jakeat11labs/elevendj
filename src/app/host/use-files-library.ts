"use client";

import { useCallback, useState } from "react";

import type { QueueItem } from "@/lib/status";

import { slugify, trackName } from "./format";

/**
 * File-library view for the host console: the active session's files come from
 * the polled overview; picking a past/all session fetches that set on demand.
 * Also owns the per-file downloads. Selection (`filesSel`) is shared with the
 * queue, so it stays parent-owned and is injected. `resetFilesView` lets the
 * session-create flow snap back to the active view.
 */
export function useFilesLibrary({
  overviewFiles,
  authHeader,
  onError,
  filesSel,
  setFilesSel,
}: {
  overviewFiles: QueueItem[] | undefined;
  authHeader: Record<string, string>;
  onError: (message: string) => void;
  filesSel: Set<string>;
  setFilesSel: (next: Set<string>) => void;
}) {
  const [filesSessionId, setFilesSessionId] = useState<string | null>(null);
  const [sessionFiles, setSessionFiles] = useState<QueueItem[] | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);

  const files = filesSessionId === null ? overviewFiles ?? [] : sessionFiles ?? [];

  // Back to the active-session files view (driven by the polled overview).
  const resetFilesView = useCallback(() => {
    setFilesSessionId(null);
    setSessionFiles(null);
  }, []);

  // Fetch a specific session's (or all sessions') files for the library view.
  const loadSessionFiles = useCallback(
    async (sessionId: string) => {
      setFilesLoading(true);
      try {
        const response = await fetch(
          `/api/admin/files?sessionId=${encodeURIComponent(sessionId)}`,
          { headers: authHeader }
        );
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          onError(body?.message || "Could not load session files.");
          return;
        }
        setSessionFiles((body?.files as QueueItem[]) ?? []);
      } catch {
        onError("Network error loading session files.");
      } finally {
        setFilesLoading(false);
      }
    },
    [authHeader, onError]
  );

  function onPickSession(value: string) {
    setFilesSel(new Set());
    if (value === "active") {
      resetFilesView();
      return;
    }
    setFilesSessionId(value);
    void loadSessionFiles(value);
  }

  // After a file mutation, keep whichever library view is on screen fresh:
  // the active view comes from overview.files (refresh), a past/all view from
  // its own fetch.
  const refreshFilesView = useCallback(async () => {
    if (filesSessionId !== null) {
      await loadSessionFiles(filesSessionId);
    }
  }, [filesSessionId, loadSessionFiles]);

  const downloadFile = useCallback(
    async (item: QueueItem) => {
      if (!item.audioUrl) {
        return;
      }
      try {
        const response = await fetch(item.audioUrl);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = `${slugify(trackName(item))}.mp3`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      } catch {
        onError("Download failed.");
      }
    },
    [onError]
  );

  async function downloadSelected() {
    const targets = files.filter((item) => filesSel.has(item.id));
    for (const item of targets) {
      // Sequential to avoid the browser blocking parallel downloads.
      await downloadFile(item);
    }
  }

  return {
    files,
    filesLoading,
    filesSessionId,
    onPickSession,
    refreshFilesView,
    resetFilesView,
    downloadFile,
    downloadSelected,
  };
}
