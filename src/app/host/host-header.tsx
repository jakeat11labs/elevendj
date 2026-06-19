"use client";

import {
  Layers,
  LogOut,
  Monitor,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";

import { HostTourButton } from "@/components/host-tour-button";
import type { QueueSnapshot } from "@/lib/status";

/**
 * Host console header: title + session name, the control-strip buttons (stage,
 * orb, sessions, admin, refresh, sign out), the live status-count row, and the
 * error banner. Purely presentational — all state and actions come from props.
 */
export function HostHeader({
  user,
  sessionName,
  publicCode,
  needsKeySetup,
  currentColorwaySrc,
  counts,
  error,
  onOpenOrbPicker,
  onOpenSessions,
  onRefresh,
  onSignOut,
}: {
  user: { id: string; email: string; isAdmin: boolean };
  sessionName: string | null | undefined;
  publicCode: string | null | undefined;
  needsKeySetup: boolean;
  currentColorwaySrc: string;
  counts: QueueSnapshot["counts"] | undefined;
  error: string | null;
  onOpenOrbPicker: () => void;
  onOpenSessions: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  return (
    <section className="card rise p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1
            className="text-base font-semibold"
            style={{ fontFamily: "var(--font-brand)" }}
          >
            Host console
          </h1>
          <span className="tag mono text-xs">{sessionName ?? "—"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HostTourButton userId={user.id} autoStart={!needsKeySetup} />
          <button
            type="button"
            id="tour-stage-button"
            onClick={() =>
              window.open(
                publicCode ? `/stage?code=${publicCode}` : "/stage",
                "_blank"
              )
            }
            className="btn-primary inline-flex h-9 items-center gap-2 px-3.5 text-sm"
          >
            <Monitor size={15} />
            Stage
          </button>
          <button
            type="button"
            onClick={onOpenOrbPicker}
            className="btn-ghost inline-flex h-9 items-center gap-2 px-3.5 text-sm"
            title="Choose the stage orb color"
          >
            <span
              className="size-4 shrink-0 rounded-full ring-1 ring-black/10"
              style={{
                backgroundImage: `url(${currentColorwaySrc})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
              aria-hidden
            />
            Orb
          </button>
          <button
            type="button"
            onClick={onOpenSessions}
            className="btn-ghost inline-flex h-9 items-center gap-2 px-3.5 text-sm"
          >
            <Layers size={15} />
            Sessions
          </button>
          {user.isAdmin && (
            <a
              href="/admin"
              className="btn-ghost inline-flex h-9 items-center gap-2 px-3.5 text-sm"
              title="User management"
            >
              <ShieldCheck size={15} />
              Admin
            </a>
          )}
          <button
            type="button"
            onClick={onRefresh}
            className="btn-ghost inline-flex h-9 items-center gap-2 px-3 text-sm"
            title="Refresh"
          >
            <RefreshCcw size={15} />
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="btn-ghost inline-flex h-9 items-center gap-2 px-3 text-sm"
            title={`Sign out (${user.email})`}
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>

      {/* Live counts — compact stat row */}
      {counts && (
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
          {(
            [
              ["pending", "Pending"],
              ["ready", "Ready"],
              ["queued", "Queued"],
              ["generating", "Gen"],
              ["played", "Played"],
              ["failed", "Failed"],
              ["rejected", "Rej"],
              ["archived", "Arch"],
            ] as const
          ).map(([key, label]) => (
            <div
              key={key}
              className="card-soft flex items-baseline justify-between gap-2 px-2.5 py-2"
            >
              <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--mid-gray)]">
                {label}
              </span>
              <span className="mono text-base font-semibold text-[var(--graphite)]">
                {counts[key] ?? 0}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--destructive)] bg-[rgba(180,35,24,0.06)] p-3 text-sm text-[var(--destructive)]">
          {error}
        </div>
      )}
    </section>
  );
}
