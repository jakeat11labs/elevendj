"use client";

import { useCallback, useState } from "react";

export type RequestAction =
  | "approve"
  | "reject"
  | "retry"
  | "mark_played"
  | "remove_from_queue"
  | "add_to_queue";

export type BulkAction =
  | "delete"
  | "remove_from_queue"
  | "add_to_queue"
  | "approve";

/**
 * Queue/request mutations for the host console: the per-request action
 * (approve/reject/retry/mark_played/remove/add), single-row delete, drag
 * reorder, and bulk actions — plus the busy flags that gate the UI. Injects
 * shared deps ({ authHeader, refresh, onError, setFilesSel }); every mutator
 * POSTs then awaits refresh() (no optimistic state). deleteRow also prunes the
 * deleted id from the shared file selection.
 */
export function useQueueActions({
  authHeader,
  refresh,
  onError,
  setFilesSel,
}: {
  authHeader: Record<string, string>;
  refresh: () => Promise<void> | void;
  onError: (message: string) => void;
  setFilesSel: (updater: (prev: Set<string>) => Set<string>) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reordering, setReordering] = useState(false);

  const runAction = useCallback(
    async (id: string, action: RequestAction, reason?: string) => {
      setBusyId(id);
      try {
        const response = await fetch(`/api/admin/requests/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ action, reason }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          onError(body?.message || "Admin action failed.");
          return false;
        }
        await refresh();
        return true;
      } catch {
        onError("Network error during action.");
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [authHeader, refresh, onError]
  );

  const deleteRow = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        const response = await fetch(`/api/admin/requests/${id}`, {
          method: "DELETE",
          headers: authHeader,
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          onError(body?.message || "Delete failed.");
          return;
        }
        setFilesSel((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        await refresh();
      } catch {
        onError("Network error during delete.");
      } finally {
        setBusyId(null);
      }
    },
    [authHeader, refresh, onError, setFilesSel]
  );

  const reorder = useCallback(
    async (orderedIds: string[]) => {
      setReordering(true);
      try {
        const response = await fetch("/api/admin/queue/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ orderedIds }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          onError(body?.message || "Reorder failed.");
          return;
        }
        await refresh();
      } catch {
        onError("Network error during reorder.");
      } finally {
        setReordering(false);
      }
    },
    [authHeader, refresh, onError]
  );

  const runBulk = useCallback(
    async (action: BulkAction, ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      setBulkBusy(true);
      try {
        const response = await fetch("/api/admin/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ action, ids }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          onError(body?.message || "Bulk action failed.");
          return;
        }
        await refresh();
      } catch {
        onError("Network error during bulk action.");
      } finally {
        setBulkBusy(false);
      }
    },
    [authHeader, refresh, onError]
  );

  return { busyId, bulkBusy, reordering, runAction, deleteRow, reorder, runBulk };
}
