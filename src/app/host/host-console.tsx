"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  Copy,
  Download,
  GripVertical,
  Inbox,
  ListMusic,
  Monitor,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Shield,
  SkipForward,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { AudioMeters } from "@/components/audio-meters";
import { StatusBadge } from "@/components/status-badge";
import { TrackDetailModal } from "@/components/track-detail-modal";
import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import type { QueueItem, QueueSnapshot, Session } from "@/lib/status";
import {
  asStageStatus,
  createStageChannel,
  type HostAction,
} from "@/lib/stage-sync";

const TOKEN_KEY = "elevendj-admin-token";

type Overview = {
  queue: QueueSnapshot;
  recent: QueueItem[];
  files: QueueItem[];
  sessions: Session[];
};

type RequestAction =
  | "approve"
  | "reject"
  | "retry"
  | "mark_played"
  | "remove_from_queue"
  | "add_to_queue";

type BulkAction = "delete" | "remove_from_queue" | "add_to_queue";

/** Build a safe filename from a user-provided prompt. */
function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "track";
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

export function HostConsole() {
  const audioRef = useRef<HTMLAudioElement>(null);

  // ── Auth / gate ──────────────────────────────────────────────
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  // ── Data ─────────────────────────────────────────────────────
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Player ───────────────────────────────────────────────────
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // ── Stage sync ───────────────────────────────────────────────
  // When a /stage tab is connected it becomes the single audio output; the
  // host goes silent and just sends commands / mirrors the stage's state.
  const [stageConnected, setStageConnected] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastBeatRef = useRef<number>(0);
  const stageConnectedRef = useRef(false);
  const hostStateRef = useRef<{ currentId: string | null; isPlaying: boolean }>({
    currentId: null,
    isPlaying: false,
  });

  const sendCmd = useCallback((action: HostAction, trackId?: string | null) => {
    const ch = channelRef.current;
    if (!ch) {
      return;
    }
    try {
      ch.postMessage({
        source: "host",
        type: "command",
        action,
        trackId: trackId ?? null,
      });
    } catch {
      /* channel closed */
    }
  }, []);

  // ── Sessions ─────────────────────────────────────────────────
  const [creatingSession, setCreatingSession] = useState(false);
  // Files library session view: null = active session (overview.files),
  // a uuid = that session's files, "all" = every session.
  const [filesSessionId, setFilesSessionId] = useState<string | null>(null);
  const [sessionFiles, setSessionFiles] = useState<QueueItem[] | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);

  // Tracks the last now-playing state we published, so we only POST on change.
  const lastPublishedRef = useRef<string>("");

  // ── Action state ─────────────────────────────────────────────
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [reordering, setReordering] = useState(false);

  // ── Selections ───────────────────────────────────────────────
  const [queueSel, setQueueSel] = useState<Set<string>>(new Set());
  const [filesSel, setFilesSel] = useState<Set<string>>(new Set());

  // ── Misc UI ──────────────────────────────────────────────────
  const [requestLink, setRequestLink] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY) || "";
    if (stored) {
      setToken(stored);
      setTokenInput(stored);
      setUnlocked(true);
    }
    setRequestLink(`${window.location.origin}/request`);
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
    try {
      const response = await fetch("/api/admin/overview", {
        headers: authHeader,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) {
          setUnlocked(false);
          setError(null);
        } else {
          setError(body?.message || "Admin overview unavailable.");
        }
        return;
      }
      setOverview(body as Overview);
      setError(null);
    } catch {
      setError("Network error reaching the console.");
    }
  }, [authHeader, token]);

  useRealtimeRefresh(refresh);

  useEffect(() => {
    if (!unlocked || !token) {
      return;
    }
    refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => window.clearInterval(interval);
  }, [refresh, unlocked, token]);

  function unlock() {
    const value = tokenInput.trim();
    if (!value) {
      return;
    }
    window.localStorage.setItem(TOKEN_KEY, value);
    setToken(value);
    setUnlocked(true);
    setError(null);
  }

  function lock() {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setTokenInput("");
    setUnlocked(false);
    setOverview(null);
    setIsPlaying(false);
  }

  // ── Derived data ─────────────────────────────────────────────
  const readyItems = useMemo(
    () =>
      (overview?.queue.items ?? []).filter(
        (item) => item.status === "ready" && item.audioUrl
      ),
    [overview]
  );

  // Requests awaiting host approval (approval mode), oldest first.
  const pendingItems = useMemo(
    () =>
      (overview?.queue.items ?? []).filter((item) => item.status === "pending"),
    [overview]
  );

  const sessions = useMemo(() => overview?.sessions ?? [], [overview]);
  const activeSession = useMemo(
    () => sessions.find((session) => session.isActive) ?? null,
    [sessions]
  );

  // Files shown in the library: default/active uses overview.files; picking a
  // past session (or "all") swaps in the separately fetched session files.
  const files =
    filesSessionId === null
      ? overview?.files ?? []
      : sessionFiles ?? [];

  const current = useMemo(() => {
    if (readyItems.length === 0) {
      return null;
    }
    return readyItems.find((item) => item.id === currentId) ?? readyItems[0];
  }, [currentId, readyItems]);

  useEffect(() => {
    if (!currentId && current) {
      setCurrentId(current.id);
    }
  }, [current, currentId]);

  // Keep refs fresh for the (mount-only) channel listener.
  useEffect(() => {
    stageConnectedRef.current = stageConnected;
    hostStateRef.current = { currentId: current?.id ?? null, isPlaying };
  });

  // Open the sync channel: detect a connected stage, hand off audio to it,
  // and mirror its playback state for display.
  useEffect(() => {
    const ch = createStageChannel();
    channelRef.current = ch;
    if (!ch) {
      return;
    }
    ch.onmessage = (event: MessageEvent) => {
      const st = asStageStatus(event.data);
      if (!st) {
        return;
      }
      lastBeatRef.current = Date.now();
      if (st.type === "bye") {
        setStageConnected(false);
        return;
      }
      setStageConnected(true);
      if (st.type === "hello") {
        // A stage just came online — silence local audio and hand off.
        audioRef.current?.pause();
        sendCmd("select", hostStateRef.current.currentId);
        if (hostStateRef.current.isPlaying) {
          sendCmd("play");
        }
        return;
      }
      if (st.type === "state") {
        // Mirror the stage (display only; local audio stays gated off).
        setCurrentId(st.currentId);
        setIsPlaying(st.isPlaying);
      }
    };
    const timer = window.setInterval(() => {
      if (lastBeatRef.current && Date.now() - lastBeatRef.current > 6000) {
        setStageConnected(false);
      }
    }, 2000);
    return () => {
      window.clearInterval(timer);
      ch.close();
      channelRef.current = null;
    };
  }, [sendCmd]);

  // ── Request action helper ────────────────────────────────────
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
          setError(body?.message || "Admin action failed.");
          return false;
        }
        await refresh();
        return true;
      } catch {
        setError("Network error during action.");
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [authHeader, refresh]
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
          setError(body?.message || "Delete failed.");
          return;
        }
        setFilesSel((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        await refresh();
      } catch {
        setError("Network error during delete.");
      } finally {
        setBusyId(null);
      }
    },
    [authHeader, refresh]
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
          setError(body?.message || "Reorder failed.");
          return;
        }
        await refresh();
      } catch {
        setError("Network error during reorder.");
      } finally {
        setReordering(false);
      }
    },
    [authHeader, refresh]
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
          setError(body?.message || "Bulk action failed.");
          return;
        }
        await refresh();
      } catch {
        setError("Network error during bulk action.");
      } finally {
        setBulkBusy(false);
      }
    },
    [authHeader, refresh]
  );

  // ── Session actions ──────────────────────────────────────────
  const [togglingRequests, setTogglingRequests] = useState(false);
  const toggleRequests = useCallback(async () => {
    const next = !(overview?.queue.requestsOpen ?? true);
    setTogglingRequests(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ requestsOpen: next }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Could not update the request line.");
        return;
      }
      await refresh();
    } catch {
      setError("Network error updating the request line.");
    } finally {
      setTogglingRequests(false);
    }
  }, [authHeader, refresh, overview]);

  const [togglingAutoDj, setTogglingAutoDj] = useState(false);
  const toggleAutoDj = useCallback(async () => {
    const next = !(overview?.queue.autoDj ?? true);
    setTogglingAutoDj(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ autoDj: next }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Could not update AutoDJ.");
        return;
      }
      await refresh();
    } catch {
      setError("Network error updating AutoDJ.");
    } finally {
      setTogglingAutoDj(false);
    }
  }, [authHeader, refresh, overview]);

  const createSession = useCallback(async () => {
    if (
      !window.confirm(
        "Start a fresh session? This ends the current session and clears the live queue. Past tracks stay available in Files."
      )
    ) {
      return;
    }
    setCreatingSession(true);
    try {
      const response = await fetch("/api/admin/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Could not start a new session.");
        return;
      }
      // Back to the active-session files view.
      setFilesSessionId(null);
      setSessionFiles(null);
      setCurrentId(null);
      setIsPlaying(false);
      await refresh();
    } catch {
      setError("Network error starting a new session.");
    } finally {
      setCreatingSession(false);
    }
  }, [authHeader, refresh]);

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
          setError(body?.message || "Could not load session files.");
          return;
        }
        setSessionFiles((body?.files as QueueItem[]) ?? []);
      } catch {
        setError("Network error loading session files.");
      } finally {
        setFilesLoading(false);
      }
    },
    [authHeader]
  );

  function onPickSession(value: string) {
    setFilesSel(new Set());
    if (value === "active") {
      setFilesSessionId(null);
      setSessionFiles(null);
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

  // ── Publish now-playing (drives request banner + stage) ──────
  useEffect(() => {
    if (!unlocked || !token) {
      return;
    }
    // When a stage is connected, it owns publishing now-playing.
    if (stageConnected) {
      return;
    }
    const requestId = current?.id ?? null;
    const signature = `${requestId ?? "none"}:${isPlaying ? "1" : "0"}`;
    if (signature === lastPublishedRef.current) {
      return;
    }
    lastPublishedRef.current = signature;
    void fetch("/api/admin/playback", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ requestId, isPlaying }),
    }).catch(() => {
      // A failed publish shouldn't block playback; allow a retry next change.
      lastPublishedRef.current = "";
    });
  }, [authHeader, current?.id, isPlaying, token, unlocked, stageConnected]);

  // ── Track details modal ──────────────────────────────────────
  const [detailItem, setDetailItem] = useState<QueueItem | null>(null);

  // ── Drag-to-reorder ──────────────────────────────────────────
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  function dropOnto(targetId: string) {
    const sourceId = dragId;
    setDragId(null);
    setOverId(null);
    if (!sourceId || sourceId === targetId) {
      return;
    }
    const ids = readyItems.map((item) => item.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) {
      return;
    }
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void reorder(next);
  }

  // ── Player controls ──────────────────────────────────────────
  // When a stage is connected, controls drive the stage tab (single audio
  // source) instead of playing the host's own <audio>.
  const playCurrent = useCallback(async () => {
    if (stageConnectedRef.current) {
      sendCmd("play", current?.id ?? null);
      return;
    }
    if (!audioRef.current || !current?.audioUrl) {
      return;
    }
    if (audioRef.current.src !== current.audioUrl) {
      audioRef.current.src = current.audioUrl;
    }
    try {
      await audioRef.current.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }, [current, sendCmd]);

  const pauseCurrent = useCallback(() => {
    if (stageConnectedRef.current) {
      sendCmd("pause");
      return;
    }
    audioRef.current?.pause();
    setIsPlaying(false);
  }, [sendCmd]);

  const advance = useCallback(
    (markPlayed: boolean) => {
      if (stageConnectedRef.current) {
        sendCmd("next");
        return;
      }
      if (readyItems.length === 0) {
        return;
      }
      const finishedId = current?.id;
      const index = readyItems.findIndex((item) => item.id === finishedId);
      const next = readyItems[index + 1];
      setIsPlaying(false);
      if (next) {
        setCurrentId(next.id);
      } else {
        setCurrentId(null);
      }
      if (markPlayed && finishedId) {
        void runAction(finishedId, "mark_played");
      }
    },
    [current, readyItems, runAction, sendCmd]
  );

  // When the selected track changes while we intend to keep playing.
  // Skipped while a stage is connected — playback lives in the stage tab.
  useEffect(() => {
    if (stageConnectedRef.current) {
      return;
    }
    if (isPlaying) {
      playCurrent().catch(() => setIsPlaying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  // ── Download helper ──────────────────────────────────────────
  const downloadFile = useCallback(async (item: QueueItem) => {
    if (!item.audioUrl) {
      return;
    }
    try {
      const response = await fetch(item.audioUrl);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${slugify(item.prompt)}.mp3`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError("Download failed.");
    }
  }, []);

  async function downloadSelected() {
    const targets = files.filter((item) => filesSel.has(item.id));
    for (const item of targets) {
      // Sequential to avoid the browser blocking parallel downloads.
      await downloadFile(item);
    }
  }

  // ── Selection helpers ────────────────────────────────────────
  function toggle(set: Set<string>, id: string) {
    const next = new Set(set);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  }

  function copyLink() {
    if (!requestLink) {
      return;
    }
    navigator.clipboard
      ?.writeText(requestLink)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => setError("Could not copy link."));
  }

  // ── Gate screen ──────────────────────────────────────────────
  if (!unlocked) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-center px-5 pb-14 pt-2 sm:px-8">
        <section className="card rise w-full max-w-md p-7 sm:p-9">
          <p className="eyebrow mb-3">Host console</p>
          <h1 className="display text-3xl sm:text-4xl">Unlock to DJ</h1>
          <p className="mt-3 text-sm text-[var(--dark-gray)]">
            Enter the host token to control the queue and play tracks over your
            call.
          </p>
          <form
            className="mt-6 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              unlock();
            }}
          >
            <label>
              <span className="sr-only">Host token</span>
              <input
                type="password"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                className="control h-12 w-full px-4"
                placeholder="Host token"
                autoFocus
              />
            </label>
            <button
              type="submit"
              className="btn-primary inline-flex h-12 items-center justify-center gap-2 px-6"
            >
              <Shield size={18} />
              Unlock
            </button>
          </form>
          {error && (
            <p className="mt-4 text-sm text-[var(--destructive)]">{error}</p>
          )}
        </section>
      </main>
    );
  }

  // ── Console ──────────────────────────────────────────────────
  const counts = overview?.queue.counts;
  const requestsOpen = overview?.queue.requestsOpen ?? true;

  const autoDj = overview?.queue.autoDj ?? true;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-5 pb-16 pt-2 sm:px-8">
      {/* Header / status bar — compact control strip */}
      <section className="card rise p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h1
              className="text-base font-semibold"
              style={{ fontFamily: "var(--font-brand)" }}
            >
              Host console
            </h1>
            <span className="tag mono text-xs">{activeSession?.name ?? "—"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => window.open("/stage", "_blank")}
              className="btn-primary inline-flex h-9 items-center gap-2 px-3.5 text-sm"
            >
              <Monitor size={15} />
              Stage
            </button>
            <button
              type="button"
              onClick={createSession}
              disabled={creatingSession}
              className="btn-ghost inline-flex h-9 items-center gap-2 px-3.5 text-sm"
            >
              <Sparkles size={15} />
              {creatingSession ? "Starting…" : "New session"}
            </button>
            <button
              type="button"
              onClick={refresh}
              className="btn-ghost inline-flex h-9 items-center gap-2 px-3 text-sm"
              title="Refresh"
            >
              <RefreshCcw size={15} />
            </button>
            <button
              type="button"
              onClick={lock}
              className="btn-ghost inline-flex h-9 items-center gap-2 px-3 text-sm"
              title="Lock"
            >
              <Shield size={15} />
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

      {/* Working area — multi-column to use the viewport */}
      <div className="mt-4 grid gap-4 lg:grid-cols-12 lg:items-start">
        {/* Left column — controls + transport */}
        <div className="space-y-4 lg:col-span-4">
          {/* Controls — request line, AutoDJ, public link */}
          <section className="card rise p-4 sm:p-5">
            {/* Request line toggle */}
            <div className="card-soft flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="eyebrow">Request line</p>
                <p className="mt-1 text-sm text-[var(--dark-gray)]">
                  {requestsOpen
                    ? "Open — visitors can submit new tracks."
                    : "Paused — new requests are blocked."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={requestsOpen}
                disabled={togglingRequests}
                onClick={toggleRequests}
                title={requestsOpen ? "Pause requests" : "Open requests"}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                  requestsOpen
                    ? "bg-[var(--graphite)]"
                    : "bg-[var(--light-gray)]"
                }`}
              >
                <span
                  className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
                    requestsOpen ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* AutoDJ toggle */}
            <div className="card-soft mt-3 flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="eyebrow">AutoDJ</p>
                <p className="mt-1 text-sm text-[var(--dark-gray)]">
                  {autoDj
                    ? "On — requests generate automatically."
                    : "Off — you approve each request before it generates."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoDj}
                disabled={togglingAutoDj}
                onClick={toggleAutoDj}
                title={autoDj ? "Switch to approval mode" : "Turn AutoDJ on"}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                  autoDj ? "bg-[var(--graphite)]" : "bg-[var(--light-gray)]"
                }`}
              >
                <span
                  className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
                    autoDj ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Public request link */}
            <div className="card-soft mt-3 flex flex-col gap-3 p-4">
              <div className="min-w-0">
                <p className="eyebrow">Public request link</p>
                <p className="mono mt-1 truncate text-sm text-[var(--dark-gray)]">
                  {requestLink}
                </p>
              </div>
              <button
                type="button"
                onClick={copyLink}
                className="btn-ghost inline-flex h-10 shrink-0 items-center justify-center gap-2 px-4 text-sm"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </section>

          {/* Player — compact transport */}
          <section className="card rise p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <p className="eyebrow">Now playing</p>
            {stageConnected && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--light-gray)] bg-[var(--cream)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--graphite)]">
                <span className="size-1.5 rounded-full bg-[var(--graphite)]" />
                On stage
              </span>
            )}
          </div>
          <AudioMeters active={isPlaying} />
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={isPlaying ? pauseCurrent : playCurrent}
            disabled={!current?.audioUrl}
            className="btn-primary inline-flex h-10 shrink-0 items-center gap-2 px-5"
          >
            {isPlaying ? <Pause size={17} /> : <Play size={17} />}
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => advance(false)}
            disabled={readyItems.length < 2}
            className="btn-ghost inline-flex h-10 shrink-0 items-center gap-2 px-4"
            title="Next"
          >
            <SkipForward size={17} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[var(--graphite)]">
              {current ? current.prompt : "No ready track selected"}
            </p>
            <p className="truncate text-xs text-[var(--dark-gray)]">
              {current?.requesterName
                ? `Generated by ${current.requesterName}`
                : current
                  ? "Anonymous"
                  : "Queue is empty"}
              {current?.position ? (
                <span className="mono text-[var(--mid-gray)]">
                  {" · #"}
                  {current.position}
                </span>
              ) : null}
            </p>
          </div>
        </div>

        {stageConnected ? (
          <p className="mt-3 text-xs text-[var(--mid-gray)]">
            Audio plays from the stage tab — share that tab (with audio) in Zoom.
            These controls drive it.
          </p>
        ) : (
          <audio
            ref={audioRef}
            className="mt-3 w-full"
            controls
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            onEnded={() => advance(true)}
          >
            <track kind="captions" />
          </audio>
        )}
          </section>
        </div>

        {/* Middle column — pending approvals + live queue */}
        <div className="space-y-4 lg:col-span-5">
          {/* Pending approval (shown in approval mode or whenever anything waits) */}
          {(!autoDj || pendingItems.length > 0) && (
            <section className="card rise p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-xl">
                  <Inbox size={18} />
                  Pending approval
                </h2>
                <span className="mono text-sm text-[var(--mid-gray)]">
                  {pendingItems.length}
                </span>
              </div>
              <div className="space-y-2.5">
                {pendingItems.map((item) => (
                  <div key={item.id} className="card-soft p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm leading-6 text-[var(--graphite)]">
                          {item.prompt}
                        </p>
                        <p className="mt-1 text-xs text-[var(--dark-gray)]">
                          {item.requesterName
                            ? `From ${item.requesterName}`
                            : "Anonymous"}
                          <span className="mono text-[var(--mid-gray)]">
                            {" · "}
                            {formatDate(item.createdAt)}
                          </span>
                        </p>
                      </div>
                      <StatusBadge status={item.status} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => runAction(item.id, "approve")}
                        className="btn-primary inline-flex h-9 items-center gap-2 px-4 text-sm"
                      >
                        <Check size={15} />
                        Approve &amp; generate
                      </button>
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => runAction(item.id, "reject")}
                        className="btn-ghost inline-flex h-9 items-center gap-2 px-4 text-sm"
                      >
                        <X size={15} />
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
                {pendingItems.length === 0 && (
                  <p className="py-8 text-center text-sm text-[var(--mid-gray)]">
                    Nothing waiting. New requests appear here for approval.
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Queue */}
          <section className="card rise p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ListMusic size={16} />
            Queue
            <span className="mono text-xs font-normal text-[var(--mid-gray)]">
              {readyItems.length}
            </span>
          </h2>
          <span className="text-xs text-[var(--mid-gray)]">drag to reorder</span>
        </div>

        {/* Bulk bar */}
        {queueSel.size > 0 && (
          <div className="card-soft mb-4 flex flex-wrap items-center gap-3 p-3">
            <span className="text-sm text-[var(--dark-gray)]">
              {queueSel.size} selected
            </span>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={async () => {
                await runBulk("remove_from_queue", [...queueSel]);
                setQueueSel(new Set());
              }}
              className="btn-ghost inline-flex h-9 items-center gap-2 px-4 text-sm"
            >
              <X size={15} />
              Remove from queue
            </button>
            <button
              type="button"
              onClick={() => setQueueSel(new Set())}
              className="btn-ghost inline-flex h-9 items-center gap-2 px-4 text-sm"
            >
              Clear selection
            </button>
          </div>
        )}

        <div className={`space-y-1.5 ${reordering ? "opacity-60" : ""}`}>
          {readyItems.map((item, index) => {
            const isCurrent = item.id === current?.id;
            const isOver = !!dragId && dragId !== item.id && overId === item.id;
            const isDragging = dragId === item.id;
            return (
              <div
                key={item.id}
                draggable
                onDragStart={(event) => {
                  setDragId(item.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (overId !== item.id) setOverId(item.id);
                }}
                onDragLeave={() => {
                  if (overId === item.id) setOverId(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  dropOnto(item.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                className={`card-soft flex items-center gap-2.5 px-2.5 py-2 transition ${
                  isCurrent ? "border-[var(--graphite)]" : ""
                } ${isOver ? "ring-2 ring-[var(--graphite)]" : ""} ${
                  isDragging ? "opacity-40" : ""
                }`}
              >
                <GripVertical
                  size={15}
                  className="shrink-0 cursor-grab text-[var(--mid-gray)] active:cursor-grabbing"
                  aria-hidden
                />
                <input
                  type="checkbox"
                  checked={queueSel.has(item.id)}
                  onChange={() => setQueueSel((prev) => toggle(prev, item.id))}
                  className="size-4 shrink-0 accent-[var(--graphite)]"
                  aria-label="Select queue item"
                />
                <span className="mono w-5 shrink-0 text-xs text-[var(--mid-gray)]">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setDetailItem(item)}
                    className="block w-full truncate text-left text-sm text-[var(--graphite)] hover:underline"
                    title="View details"
                  >
                    {item.prompt}
                  </button>
                  <p className="truncate text-xs text-[var(--mid-gray)]">
                    {item.requesterName
                      ? `Generated by ${item.requesterName}`
                      : "Anonymous"}
                  </p>
                </div>
                {isCurrent && (
                  <span className="mr-0.5 hidden shrink-0 sm:block">
                    <AudioMeters active={isPlaying} />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setCurrentId(item.id);
                    if (stageConnected) sendCmd("select", item.id);
                    else setIsPlaying(true);
                  }}
                  className="btn-primary inline-flex size-8 shrink-0 items-center justify-center"
                  title="Play this"
                >
                  <Play size={14} />
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => runAction(item.id, "remove_from_queue")}
                  className="btn-ghost inline-flex size-8 shrink-0 items-center justify-center"
                  title="Remove from queue"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
          {readyItems.length === 0 && (
            <p className="py-8 text-center text-sm text-[var(--mid-gray)]">
              No ready tracks in the queue yet.
            </p>
          )}
        </div>
          </section>
        </div>

        {/* Right column — file library */}
        <div className="min-w-0 space-y-4 lg:col-span-3">
          {/* Files / library */}
          <section className="card rise min-w-0 overflow-hidden p-4 sm:p-5">
        <div className="mb-5 min-w-0 space-y-3">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-2 text-xl">
              <Download size={18} className="shrink-0" />
              Files
            </h2>
            <span className="mono shrink-0 text-sm text-[var(--mid-gray)]">
              {filesLoading ? "Loading…" : `${files.length} total`}
            </span>
          </div>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="eyebrow">Session</span>
            <select
              value={filesSessionId ?? "active"}
              onChange={(event) => onPickSession(event.target.value)}
              className="control h-10 w-full min-w-0 max-w-full px-3 text-sm"
            >
              <option value="active">
                {activeSession
                  ? `${activeSession.name} (active)`
                  : "Active session"}
              </option>
              <option value="all">All sessions</option>
              {sessions
                .filter((session) => !session.isActive)
                .map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.name}
                    {typeof session.trackCount === "number"
                      ? ` (${session.trackCount})`
                      : ""}
                  </option>
                ))}
            </select>
          </label>
        </div>

        {/* Bulk bar */}
        {filesSel.size > 0 && (
          <div className="card-soft mb-4 flex flex-wrap items-center gap-3 p-3">
            <span className="text-sm text-[var(--dark-gray)]">
              {filesSel.size} selected
            </span>
            <button
              type="button"
              onClick={downloadSelected}
              className="btn-ghost inline-flex h-9 items-center gap-2 px-4 text-sm"
            >
              <Download size={15} />
              Download selected
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={async () => {
                await runBulk("add_to_queue", [...filesSel]);
                await refreshFilesView();
                setFilesSel(new Set());
              }}
              className="btn-ghost inline-flex h-9 items-center gap-2 px-4 text-sm"
            >
              <Plus size={15} />
              Add to queue
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={async () => {
                if (
                  !window.confirm(
                    `Permanently delete ${filesSel.size} file(s)? This removes the audio and the record.`
                  )
                ) {
                  return;
                }
                await runBulk("delete", [...filesSel]);
                await refreshFilesView();
                setFilesSel(new Set());
              }}
              className="btn-danger inline-flex h-9 items-center gap-2 px-4 text-sm"
            >
              <Trash2 size={15} />
              Delete selected
            </button>
            <button
              type="button"
              onClick={() => setFilesSel(new Set())}
              className="btn-ghost inline-flex h-9 items-center gap-2 px-4 text-sm"
            >
              Clear selection
            </button>
          </div>
        )}

        <div className="space-y-2">
          {files.map((item) => (
            <div key={item.id} className="card-soft p-3.5">
              <div className="flex min-w-0 items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={filesSel.has(item.id)}
                  onChange={() => setFilesSel((prev) => toggle(prev, item.id))}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--graphite)]"
                  aria-label="Select file"
                />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium leading-snug text-[var(--graphite)]">
                    {item.prompt}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-[var(--mid-gray)]">
                    {item.requesterName ?? "Anonymous"}
                    <span className="mono">
                      {" · "}
                      {formatDate(item.createdAt)}
                    </span>
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--light-gray)] pt-2.5">
                <StatusBadge status={item.status} />
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => downloadFile(item)}
                    disabled={!item.audioUrl}
                    className="btn-ghost inline-flex size-8 shrink-0 items-center justify-center"
                    title="Download"
                    aria-label="Download"
                  >
                    <Download size={15} />
                  </button>
                  {item.status !== "ready" && (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={async () => {
                        await runAction(item.id, "add_to_queue");
                        await refreshFilesView();
                      }}
                      className="btn-ghost inline-flex size-8 shrink-0 items-center justify-center"
                      title="Add to queue"
                      aria-label="Add to queue"
                    >
                      <Plus size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={async () => {
                      if (
                        window.confirm(
                          "Permanently delete this file? This removes the audio and the record."
                        )
                      ) {
                        await deleteRow(item.id);
                        await refreshFilesView();
                      }
                    }}
                    className="btn-danger inline-flex size-8 shrink-0 items-center justify-center"
                    title="Delete"
                    aria-label="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {files.length === 0 && (
            <p className="py-8 text-center text-sm text-[var(--mid-gray)]">
              No files yet.
            </p>
          )}
        </div>
          </section>
        </div>
      </div>

      <TrackDetailModal item={detailItem} onClose={() => setDetailItem(null)} />
    </main>
  );
}
