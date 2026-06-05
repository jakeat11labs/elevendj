"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Pencil,
  Radio,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import type { Session } from "@/lib/status";

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

export function SessionsModal({
  open,
  sessions,
  onClose,
  onChanged,
  onCreateSession,
  creatingSession,
}: {
  open: boolean;
  sessions: Session[];
  onClose: () => void;
  /** Refresh the host overview after a mutation. */
  onChanged: () => Promise<void> | void;
  /** Reuse the console's "new session" flow (ends current, clears queue). */
  onCreateSession: () => Promise<void> | void;
  creatingSession: boolean;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Active session pinned to the top, then newest first.
  const ordered = useMemo(
    () =>
      [...sessions].sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      }),
    [sessions]
  );

  if (!open) return null;

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.message || "Could not update the session.");
        return false;
      }
      await onChanged();
      return true;
    } catch {
      setError("Network error updating the session.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function makeLive(session: Session) {
    if (session.isActive) return;
    if (
      !window.confirm(
        `Make “${session.name}” the live session? Your current live session is paused (its tracks stay safe) and the public request link switches to this one.`
      )
    ) {
      return;
    }
    await patch(session.id, { activate: true });
  }

  function startRename(session: Session) {
    setEditingId(session.id);
    setEditName(session.name);
    setError(null);
  }

  async function saveRename(id: string) {
    const name = editName.trim();
    if (!name) {
      setError("Session name can’t be empty.");
      return;
    }
    const ok = await patch(id, { name });
    if (ok) setEditingId(null);
  }

  async function remove(session: Session) {
    if (session.isActive) return;
    const count = session.trackCount ?? 0;
    if (
      !window.confirm(
        count > 0
          ? `Delete “${session.name}” and its ${count} track${
              count === 1 ? "" : "s"
            }? This permanently removes the audio and records.`
          : `Delete “${session.name}”? This can’t be undone.`
      )
    ) {
      return;
    }
    setBusyId(session.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/sessions/${session.id}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.message || "Could not delete the session.");
        return;
      }
      await onChanged();
    } catch {
      setError("Network error deleting the session.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div className="card relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--light-gray)] p-5">
          <div className="min-w-0">
            <h2
              className="text-lg leading-snug text-[var(--graphite)]"
              style={{ fontFamily: "var(--font-brand)" }}
            >
              Sessions
            </h2>
            <p className="mt-1 text-sm text-[var(--mid-gray)]">
              Switch which session is live, rename, or clean up old ones.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost inline-flex size-9 shrink-0 items-center justify-center"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--destructive)] bg-[rgba(180,35,24,0.06)] p-3 text-sm text-[var(--destructive)]">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={() => onCreateSession()}
            disabled={creatingSession}
            className="btn-primary mb-4 inline-flex h-10 w-full items-center justify-center gap-2 text-sm"
          >
            <Sparkles size={15} />
            {creatingSession ? "Starting…" : "Start a new session"}
          </button>

          <div className="space-y-2.5">
            {ordered.map((session) => {
              const isEditing = editingId === session.id;
              const busy = busyId === session.id;
              return (
                <div key={session.id} className="card-soft p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            value={editName}
                            onChange={(event) => setEditName(event.target.value)}
                            maxLength={80}
                            autoFocus
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void saveRename(session.id);
                              } else if (event.key === "Escape") {
                                setEditingId(null);
                              }
                            }}
                            className="control h-9 w-full px-3 text-sm"
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => saveRename(session.id)}
                            className="btn-primary inline-flex size-9 shrink-0 items-center justify-center"
                            title="Save name"
                            aria-label="Save name"
                          >
                            <Check size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="btn-ghost inline-flex size-9 shrink-0 items-center justify-center"
                            title="Cancel"
                            aria-label="Cancel"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium text-[var(--graphite)]">
                              {session.name}
                            </p>
                            {session.isActive && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--light-gray)] bg-[var(--cream)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--graphite)]">
                                <Radio size={10} />
                                Live
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-[var(--mid-gray)]">
                            {session.trackCount ?? 0} track
                            {(session.trackCount ?? 0) === 1 ? "" : "s"}
                            <span className="mono">
                              {" · "}
                              {formatDate(session.createdAt)}
                            </span>
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  {!isEditing && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!session.isActive && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => makeLive(session)}
                          className="btn-primary inline-flex h-9 items-center gap-2 px-4 text-sm"
                        >
                          <Radio size={15} />
                          Make live
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => startRename(session)}
                        className="btn-ghost inline-flex h-9 items-center gap-2 px-4 text-sm"
                      >
                        <Pencil size={15} />
                        Rename
                      </button>
                      {!session.isActive && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => remove(session)}
                          className="btn-danger inline-flex h-9 items-center gap-2 px-4 text-sm"
                        >
                          <Trash2 size={15} />
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {ordered.length === 0 && (
              <p className="py-8 text-center text-sm text-[var(--mid-gray)]">
                No sessions yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
