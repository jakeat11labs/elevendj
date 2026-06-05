"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, HardDrive, RefreshCcw, Trash2 } from "lucide-react";

type BlobEntry = {
  pathname: string;
  url: string;
  size: number;
  uploadedAt: string;
  referenced: boolean;
  requestId: string | null;
  title: string | null;
  status: string | null;
  sessionName: string | null;
  hostEmail: string | null;
};

type BlobStats = {
  totalCount: number;
  totalSize: number;
  referencedCount: number;
  orphanCount: number;
  orphanSize: number;
  truncated: boolean;
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(value >= 10 || exp === 0 ? 0 : 1)} ${units[exp]}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function trackLabel(entry: BlobEntry): string {
  return entry.title?.trim() || entry.pathname.replace(/^tracks\//, "");
}

export function AdminStoragePanel() {
  const [stats, setStats] = useState<BlobStats | null>(null);
  const [entries, setEntries] = useState<BlobEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/blobs/stats", {
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Could not load storage stats.");
        return;
      }
      setStats(body as BlobStats);
    } catch {
      setError("Network error loading storage stats.");
    }
  }, []);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/blobs", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Could not load files.");
        return;
      }
      setEntries((body?.entries as BlobEntry[]) ?? []);
      setCursor(body?.cursor ?? null);
      setHasMore(Boolean(body?.hasMore));
      setError(null);
    } catch {
      setError("Network error loading files.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadStats(), loadFirstPage()]);
  }, [loadStats, loadFirstPage]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/admin/blobs?cursor=${encodeURIComponent(cursor)}`,
        { cache: "no-store" }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Could not load more files.");
        return;
      }
      setEntries((prev) => [...prev, ...((body?.entries as BlobEntry[]) ?? [])]);
      setCursor(body?.cursor ?? null);
      setHasMore(Boolean(body?.hasMore));
    } catch {
      setError("Network error loading more files.");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor]);

  const cleanupOrphans = useCallback(async () => {
    if (
      !window.confirm(
        "Delete all orphaned files? These have no live reference in the app — the audio is permanently removed."
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/blobs/cleanup", {
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Cleanup failed.");
        return;
      }
      await refreshAll();
    } catch {
      setError("Network error during cleanup.");
    } finally {
      setBusy(false);
    }
  }, [refreshAll]);

  const deleteOne = useCallback(
    async (entry: BlobEntry) => {
      if (
        !window.confirm(
          entry.referenced
            ? `“${trackLabel(
                entry
              )}” is still in use. Deleting removes the audio and archives the track. Continue?`
            : `Delete “${trackLabel(entry)}”? This permanently removes the audio.`
        )
      ) {
        return;
      }
      setBusyPath(entry.pathname);
      setError(null);
      try {
        const response = await fetch("/api/admin/blobs", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pathname: entry.pathname }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(body?.message || "Could not delete the file.");
          return;
        }
        setEntries((prev) => prev.filter((e) => e.pathname !== entry.pathname));
        await loadStats();
      } catch {
        setError("Network error deleting the file.");
      } finally {
        setBusyPath(null);
      }
    },
    [loadStats]
  );

  const statCards: { label: string; value: string; hint?: string }[] = stats
    ? [
        { label: "Total used", value: formatBytes(stats.totalSize) },
        { label: "Files", value: String(stats.totalCount) },
        { label: "Referenced", value: String(stats.referencedCount) },
        {
          label: "Orphans",
          value: String(stats.orphanCount),
          hint: formatBytes(stats.orphanSize),
        },
      ]
    : [];

  return (
    <section className="card rise mt-4 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <HardDrive size={16} />
          <h2 className="text-base font-semibold">Blob storage</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshAll()}
            className="btn-ghost inline-flex h-9 items-center gap-2 px-3 text-sm"
            title="Refresh"
          >
            <RefreshCcw size={15} />
          </button>
          <button
            type="button"
            onClick={cleanupOrphans}
            disabled={busy || !stats || stats.orphanCount === 0}
            className="btn-danger inline-flex h-9 items-center gap-2 px-4 text-sm"
            title={
              stats && stats.orphanCount > 0
                ? `Delete ${stats.orphanCount} orphaned file(s)`
                : "No orphans to clean up"
            }
          >
            <Trash2 size={15} />
            {busy
              ? "Cleaning…"
              : stats && stats.orphanCount > 0
                ? `Clean up ${stats.orphanCount} orphan${
                    stats.orphanCount === 1 ? "" : "s"
                  }`
                : "No orphans"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--destructive)] bg-[rgba(180,35,24,0.06)] p-3 text-sm text-[var(--destructive)]">
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="card-soft flex flex-col gap-0.5 px-3 py-2.5"
          >
            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--mid-gray)]">
              {card.label}
            </span>
            <span className="mono text-lg font-semibold text-[var(--graphite)]">
              {card.value}
            </span>
            {card.hint && (
              <span className="mono text-[11px] text-[var(--mid-gray)]">
                {card.hint}
              </span>
            )}
          </div>
        ))}
      </div>

      {stats?.truncated && (
        <p className="mt-2 text-[11px] text-[var(--mid-gray)]">
          Stats cover the first batch of files only — the store is unusually
          large.
        </p>
      )}

      {/* Blob list */}
      <div className="mt-4">
        {loading ? (
          <p className="py-8 text-center text-sm text-[var(--mid-gray)]">
            Loading files…
          </p>
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--mid-gray)]">
            No files in storage.
          </p>
        ) : (
          <div className="space-y-1.5">
            {entries.map((entry) => (
              <div
                key={entry.pathname}
                className="card-soft flex items-center gap-2.5 px-3 py-2"
              >
                <Database
                  size={14}
                  className="shrink-0 text-[var(--mid-gray)]"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-sm text-[var(--graphite)] hover:underline"
                      title={entry.pathname}
                    >
                      {trackLabel(entry)}
                    </a>
                    {entry.referenced ? (
                      <span className="shrink-0 rounded-full border border-[var(--light-gray)] bg-[var(--cream)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--graphite)]">
                        In use
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full border border-[var(--destructive)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--destructive)]">
                        Orphan
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-[var(--mid-gray)]">
                    {entry.hostEmail ? `${entry.hostEmail} · ` : ""}
                    {entry.sessionName ? `${entry.sessionName} · ` : ""}
                    <span className="mono">{formatBytes(entry.size)}</span>
                    {" · "}
                    {formatDate(entry.uploadedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyPath === entry.pathname}
                  onClick={() => deleteOne(entry)}
                  className="btn-danger inline-flex size-8 shrink-0 items-center justify-center"
                  title="Delete file"
                  aria-label="Delete file"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {hasMore && (
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="btn-ghost inline-flex h-9 items-center gap-2 px-4 text-sm"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
