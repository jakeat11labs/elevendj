"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  KeyRound,
  MonitorPlay,
  Pause,
  Play,
  Radio,
  RefreshCcw,
  SkipForward,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";

type Client = {
  id: string;
  name: string;
  ownerHostId: string;
  credentialPrefix: string;
  enabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
};

type Pairing = {
  id: string;
  displayCode: string;
  deviceName: string;
  status: string;
  sessionId: string | null;
  expiresAt: string;
  createdAt: string;
};

type Device = {
  id: string;
  name: string;
  sessionId: string | null;
  status: string;
  online: boolean;
  audioUnlocked: boolean;
  lastSeenAt: string | null;
  lastError: string | null;
};

type Room = {
  id: string;
  name: string;
  roomName: string | null;
  publicCode: string;
  externalSessionId: string | null;
  isActive: boolean;
  requestsOpen: boolean;
  autoDj: {
    enabled: boolean;
    target: number;
    brief: string | null;
    autoplay: boolean;
  };
  agendaStartsAt: string | null;
  agendaEndsAt: string | null;
  hostKeyReady: boolean;
  queue: { counts: Record<string, number>; itemCount: number };
  playback: {
    currentRequestId: string | null;
    isPlaying: boolean;
    positionMs: number;
    revision: number;
  };
  players: Device[];
};

type Overview = {
  clients: Client[];
  pendingPairings: Pairing[];
  devices: Device[];
  rooms: Room[];
};

type QueueTrack = {
  id: string;
  prompt: string;
  title: string | null;
  requesterName: string | null;
  status: string;
  kind: string;
  audioUrl: string | null;
};

function requestUrl(code: string) {
  if (typeof window === "undefined") return `/request?code=${code}`;
  return `${window.location.origin}/request?code=${encodeURIComponent(code)}`;
}

export function OffsiteConsole() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secretFlash, setSecretFlash] = useState<string | null>(null);
  const [newClientName, setNewClientName] = useState("Offsite2026 Lovable");
  const [busy, setBusy] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomTracks, setRoomTracks] = useState<QueueTrack[]>([]);
  const [assignSessionByPairing, setAssignSessionByPairing] = useState<
    Record<string, string>
  >({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/offsite/overview", {
        cache: "no-store",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          window.location.href = "/host";
          return;
        }
        setError(body?.message || "Could not load Offsite overview.");
        return;
      }
      setOverview(body as Overview);
      setError(null);
    } catch {
      setError("Network error loading Offsite overview.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const rooms = overview?.rooms ?? [];
  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === selectedRoomId) ?? rooms[0] ?? null,
    [rooms, selectedRoomId]
  );

  useEffect(() => {
    if (!selectedRoom) {
      setRoomTracks([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/offsite/rooms/${selectedRoom.id}`,
          { cache: "no-store" }
        );
        const body = await res.json().catch(() => null);
        if (!res.ok || cancelled) return;
        const items = (body?.queue?.items ?? []) as QueueTrack[];
        setRoomTracks(
          items.filter((i) => i.kind !== "station_id" && i.status === "ready")
        );
      } catch {
        /* keep last */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRoom?.id, selectedRoom?.playback.revision, selectedRoom?.queue.itemCount]);

  async function createClient() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/offsite/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newClientName }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message || "Could not create client.");
        return;
      }
      setSecretFlash(body.secret);
      await refresh();
    } catch {
      setError("Network error creating client.");
    } finally {
      setBusy(false);
    }
  }

  async function patchClient(id: string, action: "rotate" | "enable" | "disable") {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/offsite/clients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message || "Could not update client.");
        return;
      }
      if (body.secret) setSecretFlash(body.secret);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function decidePairing(
    pairingId: string,
    action: "approve" | "reject",
    sessionId?: string | null
  ) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/offsite/pairings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairingId, action, sessionId: sessionId ?? null }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message || "Could not update pairing.");
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function patchDevice(
    deviceId: string,
    action: "assign" | "unassign" | "revoke",
    sessionId?: string | null
  ) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/offsite/devices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, action, sessionId: sessionId ?? null }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message || "Could not update device.");
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setRoomAutoDj(
    sessionId: string,
    patch: { enabled?: boolean; brief?: string | null }
  ) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/offsite/rooms/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message || "Could not update AutoDJ.");
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function playback(
    action: "play" | "pause" | "skip" | "select",
    trackId?: string
  ) {
    if (!selectedRoom) return;
    const expectedRevision = selectedRoom.playback.revision;
    setBusy(true);
    try {
      const payload =
        action === "select"
          ? { action, trackId, autoplay: true, expectedRevision }
          : { action, expectedRevision };
      const res = await fetch(`/api/admin/offsite/rooms/${selectedRoom.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `${action}-${expectedRevision}-${Date.now()}`,
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message || "Playback command failed.");
        await refresh();
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="min-h-screen bg-[var(--cream)] text-[var(--graphite)]">
      <header className="border-b border-[var(--light-gray)] bg-white/70 px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--mid-gray)]">
              Superadmin
            </p>
            <h1
              className="text-2xl"
              style={{ fontFamily: "var(--font-brand)" }}
            >
              Offsite DJ
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin"
              className="btn-ghost inline-flex h-9 items-center gap-2 px-3.5 text-sm"
            >
              <Users size={15} />
              Users
            </Link>
            <Link
              href="/player"
              className="btn-ghost inline-flex h-9 items-center gap-2 px-3.5 text-sm"
            >
              <MonitorPlay size={15} />
              Open player
            </Link>
            <button
              type="button"
              className="btn-ghost inline-flex h-9 items-center gap-2 px-3.5 text-sm"
              onClick={() => void refresh()}
            >
              <RefreshCcw size={15} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[1.1fr_0.9fr]">
        {error && (
          <div className="lg:col-span-2 rounded-[var(--radius-md)] border border-[var(--destructive)] bg-[rgba(180,35,24,0.06)] p-3 text-sm text-[var(--destructive)]">
            {error}
            <button
              type="button"
              className="ml-3 underline"
              onClick={() => setError(null)}
            >
              dismiss
            </button>
          </div>
        )}

        {secretFlash && (
          <div className="lg:col-span-2 card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  Copy this integration secret now — it won’t be shown again.
                </p>
                <code className="mt-2 block break-all rounded bg-[var(--cream)] p-3 text-xs">
                  {secretFlash}
                </code>
              </div>
              <button
                type="button"
                className="btn-ghost size-9"
                onClick={() => setSecretFlash(null)}
                aria-label="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
            <button
              type="button"
              className="btn-primary mt-3 inline-flex h-9 items-center gap-2 px-4 text-sm"
              onClick={() => void copy(secretFlash)}
            >
              <Copy size={14} />
              Copy secret
            </button>
          </div>
        )}

        <section className="space-y-4">
          <div className="card p-5">
            <h2 className="text-lg" style={{ fontFamily: "var(--font-brand)" }}>
              Agenda rooms
            </h2>
            <p className="mt-1 text-sm text-[var(--mid-gray)]">
              Concurrent integration sessions. Create them via the Lovable API
              upsert; control playback here.
            </p>
            <div className="mt-4 space-y-2">
              {rooms.length === 0 && (
                <p className="py-6 text-center text-sm text-[var(--mid-gray)]">
                  No Offsite sessions yet. Upsert one with the Integration API.
                </p>
              )}
              {rooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setSelectedRoomId(room.id)}
                  className={`card-soft w-full p-4 text-left ${
                    selectedRoom?.id === room.id
                      ? "ring-2 ring-[var(--graphite)]"
                      : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{room.name}</p>
                      <p className="mt-1 text-xs text-[var(--mid-gray)]">
                        {room.roomName || "No room"} ·{" "}
                        {room.queue.itemCount} in queue · rev{" "}
                        {room.playback.revision}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--light-gray)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                      <Radio size={10} />
                      {room.isActive ? "Live" : "Ended"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedRoom && (
            <div className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3
                    className="text-lg"
                    style={{ fontFamily: "var(--font-brand)" }}
                  >
                    {selectedRoom.name}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--mid-gray)]">
                    {selectedRoom.externalSessionId
                      ? `ext: ${selectedRoom.externalSessionId}`
                      : "no external id"}
                    {!selectedRoom.hostKeyReady ? " · host key missing" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-ghost inline-flex h-9 items-center gap-2 px-3 text-sm"
                    onClick={() =>
                      void copy(requestUrl(selectedRoom.publicCode))
                    }
                  >
                    <Copy size={14} />
                    Request link
                  </button>
                  <a
                    className="btn-ghost inline-flex h-9 items-center gap-2 px-3 text-sm"
                    href={`/stage?code=${encodeURIComponent(selectedRoom.publicCode)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Stage
                  </a>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="btn-primary inline-flex h-10 items-center gap-2 px-4 text-sm"
                  onClick={() =>
                    void playback(
                      selectedRoom.playback.isPlaying ? "pause" : "play"
                    )
                  }
                >
                  {selectedRoom.playback.isPlaying ? (
                    <Pause size={15} />
                  ) : (
                    <Play size={15} />
                  )}
                  {selectedRoom.playback.isPlaying ? "Pause" : "Play"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="btn-ghost inline-flex h-10 items-center gap-2 px-4 text-sm"
                  onClick={() => void playback("skip")}
                >
                  <SkipForward size={15} />
                  Skip
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={`inline-flex h-10 items-center gap-2 px-4 text-sm ${
                    selectedRoom.autoDj.enabled ? "btn-primary" : "btn-ghost"
                  }`}
                  onClick={() =>
                    void setRoomAutoDj(selectedRoom.id, {
                      enabled: !selectedRoom.autoDj.enabled,
                    })
                  }
                  title={
                    selectedRoom.autoDj.enabled
                      ? "Stop generating house tracks for this room"
                      : "Keep this room stocked when requests dry up"
                  }
                >
                  <Sparkles size={15} />
                  AutoDJ {selectedRoom.autoDj.enabled ? "on" : "off"}
                </button>
              </div>

              {selectedRoom.autoDj.enabled && (
                <p className="mt-2 text-xs text-[var(--mid-gray)]">
                  {selectedRoom.autoDj.brief
                    ? `Brief: ${selectedRoom.autoDj.brief}`
                    : "No brief from the portal — using a house style."}
                </p>
              )}

              <div className="mt-4 space-y-2">
                {roomTracks.length === 0 && (
                  <p className="text-sm text-[var(--mid-gray)]">
                    No ready tracks in this room yet.
                  </p>
                )}
                {roomTracks.map((track) => {
                  const active =
                    track.id === selectedRoom.playback.currentRequestId;
                  return (
                    <div
                      key={track.id}
                      className={`flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--light-gray)] px-3 py-2 ${
                        active ? "bg-[var(--cream)]" : "bg-white"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {track.title || track.prompt}
                        </p>
                        <p className="truncate text-xs text-[var(--mid-gray)]">
                          {track.requesterName || "Anonymous"}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn-ghost h-8 px-3 text-xs"
                        disabled={busy}
                        onClick={() => void playback("select", track.id)}
                      >
                        Play
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--mid-gray)]">
                  Players in this room
                </p>
                <div className="mt-2 space-y-2">
                  {(selectedRoom.players ?? []).length === 0 && (
                    <p className="text-sm text-[var(--mid-gray)]">
                      No paired players assigned here.
                    </p>
                  )}
                  {selectedRoom.players.map((device) => (
                    <div
                      key={device.id}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span>
                        {device.name}{" "}
                        <span className="text-[var(--mid-gray)]">
                          · {device.online ? "online" : "offline"}
                          {!device.audioUnlocked ? " · audio locked" : ""}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn-ghost h-8 px-3 text-xs"
                        onClick={() =>
                          void patchDevice(device.id, "unassign")
                        }
                      >
                        Unassign
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="card p-5">
            <h2 className="text-lg" style={{ fontFamily: "var(--font-brand)" }}>
              Pending pairings
            </h2>
            <div className="mt-4 space-y-3">
              {(overview?.pendingPairings ?? []).length === 0 && (
                <p className="text-sm text-[var(--mid-gray)]">
                  Open `/player` on a room device to request a code.
                </p>
              )}
              {(overview?.pendingPairings ?? []).map((pairing) => (
                <div key={pairing.id} className="card-soft p-4">
                  <p className="font-medium">
                    {pairing.deviceName}{" "}
                    <span className="mono text-sm tracking-[0.18em]">
                      {pairing.displayCode}
                    </span>
                  </p>
                  <select
                    className="control mt-3 h-9 w-full px-3 text-sm"
                    value={assignSessionByPairing[pairing.id] ?? ""}
                    onChange={(e) =>
                      setAssignSessionByPairing((prev) => ({
                        ...prev,
                        [pairing.id]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Assign later</option>
                    {rooms
                      .filter((r) => r.isActive)
                      .map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.roomName || room.name}
                        </option>
                      ))}
                  </select>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      className="btn-primary inline-flex h-9 flex-1 items-center justify-center gap-2 text-sm"
                      onClick={() =>
                        void decidePairing(
                          pairing.id,
                          "approve",
                          assignSessionByPairing[pairing.id] || null
                        )
                      }
                    >
                      <Check size={14} />
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="btn-danger inline-flex h-9 flex-1 items-center justify-center gap-2 text-sm"
                      onClick={() => void decidePairing(pairing.id, "reject")}
                    >
                      <X size={14} />
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-lg" style={{ fontFamily: "var(--font-brand)" }}>
              All players
            </h2>
            <div className="mt-4 space-y-2">
              {(overview?.devices ?? []).map((device) => (
                <div key={device.id} className="card-soft p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{device.name}</p>
                      <p className="text-xs text-[var(--mid-gray)]">
                        {device.status} · {device.online ? "online" : "offline"}
                        {device.sessionId
                          ? ` · room ${device.sessionId.slice(0, 8)}`
                          : " · unassigned"}
                      </p>
                    </div>
                    {device.status === "active" && (
                      <button
                        type="button"
                        className="btn-danger inline-flex h-8 items-center gap-1 px-3 text-xs"
                        onClick={() => void patchDevice(device.id, "revoke")}
                      >
                        <Trash2 size={12} />
                        Revoke
                      </button>
                    )}
                  </div>
                  {device.status === "active" && (
                    <select
                      className="control mt-2 h-9 w-full px-3 text-xs"
                      value={device.sessionId ?? ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (!value) {
                          void patchDevice(device.id, "unassign");
                        } else {
                          void patchDevice(device.id, "assign", value);
                        }
                      }}
                    >
                      <option value="">Unassigned</option>
                      {rooms
                        .filter((r) => r.isActive)
                        .map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.roomName || room.name}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-lg" style={{ fontFamily: "var(--font-brand)" }}>
              Integration API keys
            </h2>
            <div className="mt-3 flex gap-2">
              <input
                className="control h-10 flex-1 px-3 text-sm"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                maxLength={80}
              />
              <button
                type="button"
                disabled={busy || !newClientName.trim()}
                className="btn-primary inline-flex h-10 items-center gap-2 px-4 text-sm"
                onClick={() => void createClient()}
              >
                <KeyRound size={14} />
                Create
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {(overview?.clients ?? []).map((client) => (
                <div key={client.id} className="card-soft p-3 text-sm">
                  <p className="font-medium">{client.name}</p>
                  <p className="mono text-xs text-[var(--mid-gray)]">
                    prefix {client.credentialPrefix} ·{" "}
                    {client.enabled ? "enabled" : "disabled"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-ghost h-8 px-3 text-xs"
                      onClick={() => void patchClient(client.id, "rotate")}
                    >
                      Rotate
                    </button>
                    <button
                      type="button"
                      className="btn-ghost h-8 px-3 text-xs"
                      onClick={() =>
                        void patchClient(
                          client.id,
                          client.enabled ? "disable" : "enable"
                        )
                      }
                    >
                      {client.enabled ? "Disable" : "Enable"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
