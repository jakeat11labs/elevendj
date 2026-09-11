"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Headphones,
  ListMusic,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  SkipForward,
  Sparkles,
  Trash2,
  Volume2,
  WandSparkles,
  Wifi,
  WifiOff,
} from "lucide-react";

import type { QueueItem, QueueSnapshot } from "@/lib/status";
import type { RoomPlaybackState } from "@/lib/playback/contracts";

type Player = {
  id: string;
  name: string;
  online: boolean;
  audioUnlocked: boolean;
  lastError: string | null;
};

type Room = {
  id: string;
  name: string;
  roomName: string | null;
  externalSessionId: string | null;
  isActive: boolean;
  requestsOpen: boolean;
  autoApprove: boolean;
  autoDj: { enabled: boolean; brief: string | null; target: number };
  masterVolume: number;
  forceInstrumental: boolean;
  playback: RoomPlaybackState;
  queue: QueueSnapshot;
  players: Player[];
};

type Overview = {
  operator: {
    kind: "admin" | "operator" | "emergency";
    displayName: string;
    roomScoped: boolean;
  };
  rooms: Room[];
};

function songItems(room: Room): QueueItem[] {
  return room.queue.items.filter((item) => item.kind === "song");
}

function readySongItems(room: Room): QueueItem[] {
  return songItems(room).filter((item) => item.status === "ready");
}

export function RoomDjConsole() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [accessPin, setAccessPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [instrumental, setInstrumental] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/offsite/rooms", {
        cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) {
        setUnauthorized(true);
        setOverview(null);
        return;
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Could not load the rooms.");
        return;
      }
      setOverview(body as Overview);
      setUnauthorized(false);
      setError(null);
    } catch {
      setError("Network error loading the rooms.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const token = params.get("access");
      if (token) {
        window.history.replaceState(null, "", window.location.pathname);
        if (!cancelled) {
          setAccessToken(token);
          setUnauthorized(true);
        }
        return;
      }
      if (!cancelled) await load();
    };
    void start();
    const timer = window.setInterval(() => void load(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [load]);

  const rooms = useMemo(() => overview?.rooms ?? [], [overview?.rooms]);
  const selected =
    rooms.find((room) => room.id === selectedRoomId) ?? rooms[0] ?? null;

  async function exchangeEmergencyAccess() {
    if (!accessToken || !/^\d{8}$/.test(accessPin)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/offsite/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: accessToken, pin: accessPin }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "The link or PIN was not accepted.");
        return;
      }
      setAccessToken(null);
      setAccessPin("");
      await load();
    } catch {
      setError("Network error checking the room-control link.");
    } finally {
      setBusy(false);
    }
  }

  async function mutate(
    roomId: string,
    method: "POST" | "PATCH",
    body: unknown,
    path = "",
    idempotencyKey?: string
  ) {
    setBusy(true);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      const response = await fetch(
        `/api/offsite/rooms/${roomId}${path}`,
        {
          method,
          headers,
          body: JSON.stringify(body),
        }
      );
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result?.message || "The room did not accept that change.");
        return false;
      }
      await load();
      return true;
    } catch {
      setError("Network error updating the room.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function playback(
    action: "play" | "pause" | "skip" | "select",
    trackId?: string
  ) {
    if (!selected) return;
    await mutate(
      selected.id,
      "POST",
      {
        action,
        expectedRevision: selected.playback.revision,
        ...(trackId ? { trackId, autoplay: true } : {}),
      },
      "",
      window.crypto.randomUUID()
    );
  }

  async function queueAction(
    requestId: string,
    action: "approve" | "reject" | "retry" | "remove"
  ) {
    if (!selected) return;
    await mutate(
      selected.id,
      "PATCH",
      { action },
      `/queue/${requestId}`
    );
  }

  async function moveTrack(index: number, direction: -1 | 1) {
    if (!selected) return;
    const ids = readySongItems(selected).map((item) => item.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await mutate(
      selected.id,
      "POST",
      { orderedIds: ids },
      "/queue/reorder"
    );
  }

  async function generateTrack() {
    if (!selected || prompt.trim().length < 10) return;
    setGenerating(true);
    try {
      const ok = await mutate(
        selected.id,
        "POST",
        { prompt: prompt.trim(), instrumental },
        "/requests",
        window.crypto.randomUUID()
      );
      if (ok) setPrompt("");
    } finally {
      setGenerating(false);
    }
  }

  if (unauthorized) {
    return (
      <main className="mx-auto flex min-h-[80vh] w-full max-w-xl items-center px-5">
        <section className="card w-full p-7 text-center">
          <Headphones className="mx-auto text-[var(--mid-gray)]" size={28} />
          <h1
            className="mt-4 text-3xl"
            style={{ fontFamily: "var(--font-brand)" }}
          >
            Room DJ
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm text-[var(--dark-gray)]">
            {accessToken
              ? "Enter the separate 8-digit PIN the admin gave you for this room."
              : "Sign in with a room assignment, or open the emergency control link for your room."}
          </p>
          {error && (
            <p className="mt-4 text-sm text-[var(--destructive)]">{error}</p>
          )}
          {accessToken ? (
            <div className="mx-auto mt-6 flex max-w-xs flex-col gap-3">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={8}
                value={accessPin}
                onChange={(event) =>
                  setAccessPin(event.target.value.replace(/\D/g, ""))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void exchangeEmergencyAccess();
                  }
                }}
                className="control h-12 text-center text-xl tracking-[0.3em]"
                placeholder="00000000"
                aria-label="8-digit room PIN"
              />
              <button
                type="button"
                disabled={busy || accessPin.length !== 8}
                className="btn-primary h-11 px-6 text-sm"
                onClick={() => void exchangeEmergencyAccess()}
              >
                {busy ? "Checking…" : "Open room controls"}
              </button>
            </div>
          ) : (
            <a
              href="/sign-in?redirect=/offsite/control"
              className="btn-primary mt-6 inline-flex h-11 items-center px-6 text-sm"
            >
              Sign in
            </a>
          )}
        </section>
      </main>
    );
  }

  if (!overview) {
    return (
      <main className="flex min-h-[80vh] items-center justify-center text-sm text-[var(--mid-gray)]">
        Loading room controls…
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-16 pt-2 sm:px-8">
      <header className="card rise flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="eyebrow">Cancún 2026</p>
          <h1
            className="mt-1 text-3xl"
            style={{ fontFamily: "var(--font-brand)" }}
          >
            Room DJ
          </h1>
          <p className="mt-1 text-sm text-[var(--mid-gray)]">
            Signed in as {overview.operator.displayName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!overview.operator.roomScoped && rooms.length > 1 && (
            <select
              value={selected?.id ?? ""}
              onChange={(event) => setSelectedRoomId(event.target.value)}
              className="control h-10 px-3 text-sm"
              aria-label="Room"
            >
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.roomName || room.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="btn-ghost inline-flex size-10 items-center justify-center"
            aria-label="Refresh"
          >
            <RefreshCcw size={15} />
          </button>
        </div>
      </header>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--destructive)] bg-white p-3 text-sm text-[var(--destructive)]">
          <AlertTriangle size={15} />
          {error}
          <button
            type="button"
            className="ml-auto underline"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {!selected ? (
        <section className="card mt-4 p-8 text-center text-sm text-[var(--mid-gray)]">
          No active Offsite rooms.
        </section>
      ) : (
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="space-y-4">
            <section className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">
                    {selected.roomName || "Offsite room"}
                  </p>
                  <h2
                    className="mt-1 text-2xl"
                    style={{ fontFamily: "var(--font-brand)" }}
                  >
                    {selected.name}
                  </h2>
                </div>
                <span className="tag">
                  {selected.isActive ? "Live" : "Ended"}
                </span>
              </div>

              <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--cream)] p-4">
                <p className="eyebrow">Now playing</p>
                <p className="mt-2 text-lg font-medium">
                  {songItems(selected).find(
                    (item) =>
                      item.id === selected.playback.currentRequestId
                  )?.title || "Nothing selected"}
                </p>
                <p className="mt-1 text-sm text-[var(--mid-gray)]">
                  {selected.playback.isPlaying ? "Playing" : "Paused"} · rev{" "}
                  {selected.playback.revision}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="btn-primary inline-flex h-10 items-center gap-2 px-4 text-sm"
                  onClick={() =>
                    void playback(
                      selected.playback.isPlaying ? "pause" : "play"
                    )
                  }
                >
                  {selected.playback.isPlaying ? (
                    <Pause size={15} />
                  ) : (
                    <Play size={15} />
                  )}
                  {selected.playback.isPlaying ? "Pause" : "Play"}
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
              </div>

              <div className="mt-5 border-t border-[var(--light-gray)] pt-4">
                <p className="eyebrow">Player</p>
                {selected.players.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--destructive)]">
                    No player assigned.
                  </p>
                ) : (
                  selected.players.map((player) => (
                    <div
                      key={player.id}
                      className="mt-2 flex items-center gap-2 text-sm"
                    >
                      {player.online ? (
                        <Wifi size={15} className="text-[var(--success)]" />
                      ) : (
                        <WifiOff
                          size={15}
                          className="text-[var(--destructive)]"
                        />
                      )}
                      <span>{player.name}</span>
                      <span className="text-xs text-[var(--mid-gray)]">
                        {player.online ? "online" : "offline"} ·{" "}
                        {player.audioUnlocked
                          ? "audio ready"
                          : "audio needs enabling"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="card p-5">
              <h2 className="flex items-center gap-2 text-lg">
                <WandSparkles size={17} />
                Make a track
              </h2>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
                maxLength={800}
                placeholder="Warm sunset house with soft percussion and airy keys"
                className="control mt-3 w-full resize-none p-3 text-sm"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-[var(--dark-gray)]">
                  <input
                    type="checkbox"
                    checked={instrumental}
                    onChange={(event) =>
                      setInstrumental(event.target.checked)
                    }
                    className="size-4 accent-[var(--graphite)]"
                  />
                  Instrumental
                </label>
                <button
                  type="button"
                  disabled={generating || prompt.trim().length < 10}
                  className="btn-primary inline-flex h-10 items-center gap-2 px-4 text-sm"
                  onClick={() => void generateTrack()}
                >
                  <Sparkles size={15} />
                  {generating ? "Starting…" : "Add to queue"}
                </button>
              </div>
            </section>

            <section className="card p-5">
              <h2 className="text-lg">Room settings</h2>
              <div className="mt-4 space-y-3">
                <Setting
                  label="Request line"
                  detail={
                    selected.requestsOpen
                      ? "Employees can submit requests"
                      : "Requests are paused"
                  }
                  enabled={selected.requestsOpen}
                  disabled={busy}
                  onToggle={() =>
                    void mutate(selected.id, "PATCH", {
                      requestsOpen: !selected.requestsOpen,
                    })
                  }
                />
                <Setting
                  label="AutoDJ"
                  detail={
                    selected.autoDj.enabled
                      ? "Fills gaps when requests dry up"
                      : "Room stops when the queue empties"
                  }
                  enabled={selected.autoDj.enabled}
                  disabled={busy}
                  onToggle={() =>
                    void mutate(selected.id, "PATCH", {
                      autoDjEnabled: !selected.autoDj.enabled,
                    })
                  }
                />
                {selected.autoDj.enabled && (
                  <label className="block rounded-[var(--radius-md)] bg-[var(--cream)] p-3">
                    <span className="text-sm font-medium">AutoDJ brief</span>
                    <textarea
                      key={`${selected.id}:${selected.autoDj.brief ?? ""}`}
                      defaultValue={selected.autoDj.brief ?? ""}
                      rows={2}
                      maxLength={400}
                      placeholder="Warm arrival house, relaxed and welcoming"
                      className="control mt-2 w-full resize-none p-2.5 text-sm"
                      onBlur={(event) =>
                        void mutate(selected.id, "PATCH", {
                          autoDjBrief:
                            event.currentTarget.value.trim() || null,
                        })
                      }
                    />
                  </label>
                )}
                <Setting
                  label="Auto-approve requests"
                  detail={
                    selected.autoApprove
                      ? "Requests generate immediately"
                      : "Requests wait in the queue for approval"
                  }
                  enabled={selected.autoApprove}
                  disabled={busy}
                  onToggle={() =>
                    void mutate(selected.id, "PATCH", {
                      autoApprove: !selected.autoApprove,
                    })
                  }
                />
                <label className="block pt-2">
                  <span className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <Volume2 size={15} />
                      Master volume
                    </span>
                    <span className="tabular-nums text-[var(--mid-gray)]">
                      {Math.round(selected.masterVolume * 100)}%
                    </span>
                  </span>
                  <input
                    key={`${selected.id}:${selected.masterVolume}`}
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    defaultValue={selected.masterVolume}
                    className="mt-2 w-full accent-[var(--graphite)]"
                    onPointerUp={(event) =>
                      void mutate(selected.id, "PATCH", {
                        masterVolume: Number(event.currentTarget.value),
                      })
                    }
                    onKeyUp={(event) =>
                      void mutate(selected.id, "PATCH", {
                        masterVolume: Number(event.currentTarget.value),
                      })
                    }
                  />
                </label>
              </div>
            </section>
          </div>

          <section className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg">
                <ListMusic size={17} />
                Queue
              </h2>
              <span className="tag">{songItems(selected).length} tracks</span>
            </div>
            <div className="mt-4 space-y-2">
              {songItems(selected).length === 0 && (
                <p className="py-8 text-center text-sm text-[var(--mid-gray)]">
                  No tracks yet. Add one or turn on AutoDJ.
                </p>
              )}
              {songItems(selected).map((item, index) => {
                const current =
                  item.id === selected.playback.currentRequestId;
                const ready = readySongItems(selected);
                const readyIndex = ready.findIndex(
                  (candidate) => candidate.id === item.id
                );
                return (
                  <div
                    key={item.id}
                    className={`rounded-[var(--radius-md)] border p-3 ${
                      current
                        ? "border-[var(--graphite)] bg-[var(--cream)]"
                        : "border-[var(--light-gray)] bg-white"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="mono mt-0.5 text-xs text-[var(--mid-gray)]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {item.title || item.prompt}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-[var(--mid-gray)]">
                          {item.requesterName || "Anonymous"} · {item.status}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          disabled={
                            busy ||
                            readyIndex <= 0
                          }
                          className="btn-ghost inline-flex size-8 items-center justify-center"
                          onClick={() => void moveTrack(readyIndex, -1)}
                          aria-label="Move track up"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          disabled={
                            busy ||
                            readyIndex < 0 ||
                            readyIndex === ready.length - 1
                          }
                          className="btn-ghost inline-flex size-8 items-center justify-center"
                          onClick={() => void moveTrack(readyIndex, 1)}
                          aria-label="Move track down"
                        >
                          <ArrowDown size={13} />
                        </button>
                        {item.status === "ready" && !current && (
                          <button
                            type="button"
                            disabled={busy}
                            className="btn-ghost inline-flex h-8 items-center gap-1 px-2.5 text-xs"
                            onClick={() => void playback("select", item.id)}
                          >
                            <Play size={12} />
                            Play
                          </button>
                        )}
                        {item.status === "pending" && (
                          <button
                            type="button"
                            disabled={busy}
                            className="btn-primary h-8 px-2.5 text-xs"
                            onClick={() =>
                              void queueAction(item.id, "approve")
                            }
                          >
                            Approve
                          </button>
                        )}
                        {item.status === "failed" && (
                          <button
                            type="button"
                            disabled={busy}
                            className="btn-ghost inline-flex size-8 items-center justify-center"
                            onClick={() =>
                              void queueAction(item.id, "retry")
                            }
                            aria-label="Retry track"
                          >
                            <RotateCcw size={13} />
                          </button>
                        )}
                        {!current && (
                          <button
                            type="button"
                            disabled={busy}
                            className="btn-danger inline-flex size-8 items-center justify-center"
                            onClick={() =>
                              void queueAction(item.id, "remove")
                            }
                            aria-label="Remove track"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function Setting({
  label,
  detail,
  enabled,
  disabled,
  onToggle,
}: {
  label: string;
  detail: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--cream)] p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-[var(--mid-gray)]">{detail}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={disabled}
        onClick={onToggle}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          enabled ? "bg-[var(--graphite)]" : "bg-[var(--light-gray)]"
        }`}
      >
        <span
          className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
