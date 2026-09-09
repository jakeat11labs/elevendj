"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ListMusic,
  Monitor,
  Radio,
  RefreshCcw,
  ShieldCheck,
  Users,
} from "lucide-react";

import { AdminStoragePanel } from "@/components/admin-storage-panel";
import type { Session } from "@/lib/status";

type AdminUser = {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  createdAt: string;
  sessionCount: number;
  trackCount: number;
  liveSessionCode: string | null;
  liveSessionName: string | null;
};

/** Open a session's public stage (audio + big screen) in a new tab. */
function openStage(code: string) {
  window.open(`/stage?code=${encodeURIComponent(code)}`, "_blank");
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function AdminConsole({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Expanded user → its sessions (lazily fetched).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sessionsByUser, setSessionsByUser] = useState<
    Record<string, Session[]>
  >({});
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          window.location.href = "/host";
          return;
        }
        setError(body?.message || "Could not load users.");
        return;
      }
      setUsers((body?.users as AdminUser[]) ?? []);
      setError(null);
    } catch {
      setError("Network error loading users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadSessions = useCallback(async (userId: string) => {
    setSessionsLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${userId}/sessions`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Could not load that user's sessions.");
        return;
      }
      setSessionsByUser((prev) => ({
        ...prev,
        [userId]: (body?.sessions as Session[]) ?? [],
      }));
    } catch {
      setError("Network error loading sessions.");
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  function toggleExpand(userId: string) {
    setError(null);
    if (expandedId === userId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(userId);
    if (!sessionsByUser[userId]) {
      void loadSessions(userId);
    }
  }

  const setAdmin = useCallback(
    async (user: AdminUser, isAdmin: boolean) => {
      setBusyId(user.id);
      setError(null);
      try {
        const response = await fetch(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isAdmin }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(body?.message || "Could not update admin access.");
          return;
        }
        const updated = body?.user as AdminUser | undefined;
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? updated ?? { ...u, isAdmin } : u))
        );
      } catch {
        setError("Network error updating admin access.");
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 pb-16 pt-2 sm:px-8">
      <section className="card rise p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={18} />
            <h1
              className="text-base font-semibold"
              style={{ fontFamily: "var(--font-brand)" }}
            >
              User management
            </h1>
            <span className="tag mono text-xs">{users.length} users</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={load}
              className="btn-ghost inline-flex h-9 items-center gap-2 px-3 text-sm"
              title="Refresh"
            >
              <RefreshCcw size={15} />
            </button>
            <a
              href="/admin/offsite"
              className="btn-ghost inline-flex h-9 items-center gap-2 px-3.5 text-sm"
            >
              Offsite DJ
            </a>
            <a
              href="/host"
              className="btn-ghost inline-flex h-9 items-center gap-2 px-3.5 text-sm"
            >
              Back to host
            </a>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--destructive)] bg-[rgba(180,35,24,0.06)] p-3 text-sm text-[var(--destructive)]">
            {error}
          </div>
        )}
      </section>

      <section className="card rise mt-4 p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <Users size={16} />
          <h2 className="text-base font-semibold">Users</h2>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-[var(--mid-gray)]">
            Loading…
          </p>
        ) : users.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--mid-gray)]">
            No users yet.
          </p>
        ) : (
          <div className="space-y-2.5">
            {users.map((user) => {
              const isExpanded = expandedId === user.id;
              const isSelf = user.id === currentUserId;
              const sessions = sessionsByUser[user.id];
              return (
                <div key={user.id} className="card-soft p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-[var(--graphite)]">
                          {user.displayName || user.email}
                        </p>
                        {user.isAdmin && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--light-gray)] bg-[var(--cream)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--graphite)]">
                            <ShieldCheck size={10} />
                            Admin
                          </span>
                        )}
                        {isSelf && (
                          <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--mid-gray)]">
                            You
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs text-[var(--mid-gray)]">
                        {user.displayName ? `${user.email} · ` : ""}
                        {user.sessionCount} session
                        {user.sessionCount === 1 ? "" : "s"} · {user.trackCount}{" "}
                        track{user.trackCount === 1 ? "" : "s"}
                        <span className="mono">
                          {" · joined "}
                          {formatDate(user.createdAt)}
                        </span>
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {user.liveSessionCode && (
                        <button
                          type="button"
                          onClick={() => openStage(user.liveSessionCode!)}
                          className="btn-primary inline-flex h-8 items-center gap-1.5 px-3 text-xs"
                          title={`Listen to “${
                            user.liveSessionName ?? "live session"
                          }” on the stage`}
                        >
                          <Monitor size={14} />
                          Listen
                        </button>
                      )}
                      <label className="flex items-center gap-2 text-xs text-[var(--dark-gray)]">
                        Admin
                        <button
                          type="button"
                          role="switch"
                          aria-checked={user.isAdmin}
                          disabled={busyId === user.id || (isSelf && user.isAdmin)}
                          title={
                            isSelf && user.isAdmin
                              ? "You can’t remove your own admin access"
                              : user.isAdmin
                                ? "Revoke admin"
                                : "Grant admin"
                          }
                          onClick={() => setAdmin(user, !user.isAdmin)}
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                            user.isAdmin
                              ? "bg-[var(--graphite)]"
                              : "bg-[var(--light-gray)]"
                          }`}
                        >
                          <span
                            className={`inline-block size-4 transform rounded-full bg-white shadow transition-transform ${
                              user.isAdmin ? "translate-x-6" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </label>
                      <button
                        type="button"
                        onClick={() => toggleExpand(user.id)}
                        aria-expanded={isExpanded}
                        className="btn-ghost inline-flex h-8 items-center gap-1 px-2.5 text-xs"
                      >
                        Sessions
                        <ChevronDown
                          size={13}
                          className={`transition-transform ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 border-t border-[var(--light-gray)] pt-3">
                      {sessionsLoading && !sessions ? (
                        <p className="py-3 text-center text-xs text-[var(--mid-gray)]">
                          Loading sessions…
                        </p>
                      ) : sessions && sessions.length > 0 ? (
                        <div className="space-y-1.5">
                          {sessions.map((session) => (
                            <div
                              key={session.id}
                              className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--white)] px-3 py-2"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-sm text-[var(--graphite)]">
                                  {session.name}
                                </span>
                                {session.isActive && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--light-gray)] bg-[var(--cream)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--graphite)]">
                                    <Radio size={9} />
                                    Live
                                  </span>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-2.5">
                                <span className="mono inline-flex items-center gap-1 text-xs text-[var(--mid-gray)]">
                                  <ListMusic size={13} />
                                  {session.trackCount ?? 0}
                                </span>
                                {session.publicCode && (
                                  <button
                                    type="button"
                                    onClick={() => openStage(session.publicCode!)}
                                    className={`inline-flex h-7 items-center gap-1.5 px-2.5 text-xs ${
                                      session.isActive
                                        ? "btn-primary"
                                        : "btn-ghost"
                                    }`}
                                    title="Open this session's stage"
                                  >
                                    <Monitor size={13} />
                                    Stage
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="py-3 text-center text-xs text-[var(--mid-gray)]">
                          No sessions.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <AdminStoragePanel />
    </main>
  );
}
