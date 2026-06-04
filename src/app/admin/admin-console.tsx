"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Check, RefreshCcw, RotateCcw, Shield } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import type { QueueItem, QueueSnapshot } from "@/lib/status";

type Overview = {
  queue: QueueSnapshot;
  recent: QueueItem[];
};

export function AdminConsole() {
  const [token, setToken] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setToken(window.sessionStorage.getItem("elevendj-admin-token") || "");
  }, []);

  const authHeader = useMemo<Record<string, string>>(() => {
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token) {
      return;
    }

    window.sessionStorage.setItem("elevendj-admin-token", token);
    const response = await fetch("/api/admin/overview", {
      headers: authHeader,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError(body?.message || "Admin overview unavailable.");
      return;
    }
    setOverview(body as Overview);
    setError(null);
  }, [authHeader, token]);

  useRealtimeRefresh(refresh);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  async function runAction(id: string, action: "reject" | "retry" | "mark_played") {
    setBusyId(id);
    try {
      const response = await fetch(`/api/admin/requests/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Admin action failed.");
        return;
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-14 pt-2 sm:px-8">
      <section className="card-glass rise rounded-[1.5rem] p-6 sm:p-9">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="eyebrow mb-3">Admin</p>
            <h1 className="display text-4xl sm:text-5xl">Queue control</h1>
          </div>
          <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
            <label className="flex-1">
              <span className="sr-only">Admin token</span>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="control h-12 w-full px-4 lg:w-80"
                placeholder="Admin token"
              />
            </label>
            <button
              type="button"
              onClick={refresh}
              className="btn-primary inline-flex h-12 items-center justify-center gap-2 px-6"
            >
              <Shield size={18} />
              Unlock
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-5 rounded-[var(--radius-lg)] border border-[var(--destructive)]/45 bg-[var(--destructive)]/12 p-4 text-sm text-white/90">
            {error}
          </div>
        )}
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="card-glass rise rounded-[1.5rem] p-5 sm:p-6" style={{ animationDelay: "90ms" }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl" style={{ fontFamily: "var(--font-brand)" }}>
              Live counts
            </h2>
            <button
              type="button"
              onClick={refresh}
              className="btn-ghost grid size-10 place-items-center"
              title="Refresh"
            >
              <RefreshCcw size={18} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {overview &&
              Object.entries(overview.queue.counts).map(([status, count]) => (
                <div key={status} className="card-flat rounded-[var(--radius-md)] p-3">
                  <p className="mono text-2xl text-white/90">{count}</p>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-white/45">
                    {status}
                  </p>
                </div>
              ))}
          </div>
        </div>

        <div className="card-glass rise rounded-[1.5rem] p-5 sm:p-6" style={{ animationDelay: "140ms" }}>
          <h2 className="mb-4 text-xl" style={{ fontFamily: "var(--font-brand)" }}>
            Recent requests
          </h2>
          <div className="space-y-3">
            {(overview?.recent ?? []).map((item) => (
              <div key={item.id} className="card-flat rounded-[var(--radius-lg)] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="mono text-xs text-white/40">
                      {item.position ? `#${item.position}` : item.id.slice(0, 8)}
                    </p>
                    <p className="font-medium text-white/90">
                      {item.requesterName || "Anonymous"}
                    </p>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <p className="text-sm leading-6 text-white/75">{item.prompt}</p>
                {(item.errorMessage || item.promptSuggestion) && (
                  <p className="mt-3 text-sm text-white/55">
                    {item.promptSuggestion || item.errorMessage}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => runAction(item.id, "retry")}
                    className="btn-ghost inline-flex h-10 items-center gap-2 px-4 text-sm disabled:opacity-40"
                  >
                    <RotateCcw size={16} />
                    Retry
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => runAction(item.id, "mark_played")}
                    className="btn-ghost inline-flex h-10 items-center gap-2 px-4 text-sm disabled:opacity-40"
                  >
                    <Check size={16} />
                    Played
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => runAction(item.id, "reject")}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--destructive)]/45 bg-[var(--destructive)]/14 px-4 text-sm text-white/90 transition-colors hover:bg-[var(--destructive)]/22 disabled:opacity-40"
                  >
                    <Ban size={16} />
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
