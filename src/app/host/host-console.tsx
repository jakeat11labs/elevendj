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
  ChevronDown,
  Copy,
  Disc3,
  Download,
  GripVertical,
  Inbox,
  KeyRound,
  Layers,
  ListMusic,
  LogOut,
  Monitor,
  Music2,
  Palette,
  Pause,
  Play,
  Plus,
  QrCode,
  Radio,
  RefreshCcw,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from "lucide-react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { QRCodeSVG } from "qrcode.react";

import { ApiKeySetupModal } from "@/components/api-key-setup-modal";
import { AudioMeters } from "@/components/audio-meters";
import {
  COLORWAY_NAMES,
  COLORWAYS,
  resolveColorway,
} from "@/components/orb/colorways";
import { HostTourButton } from "@/components/host-tour-button";
import { SessionsModal } from "@/components/sessions-modal";
import { StatusBadge } from "@/components/status-badge";
import { TrackDetailModal } from "@/components/track-detail-modal";
import { authClient } from "@/lib/auth/client";
import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import { useStageAudio, type Deck } from "@/lib/use-stage-audio";
import type { QueueItem, QueueSnapshot, Session } from "@/lib/status";

// Crossfade length on the host's local player — kept in sync with the stage.
const HOST_CROSSFADE_SEC = 3;
import {
  asStageStatus,
  createStageChannel,
  type HostAction,
} from "@/lib/stage-sync";

// Starter prompts for the host's own composer — DJ-flavored, not the
// audience-facing suggestions on the public form.
const HOST_IDEAS = [
  "Peak-time tech house, rolling bassline, big filtered build",
  "Smooth jazz-funk transition groove",
  "Crowd-hype anthem with a huge drop",
  "Downtempo cooldown, warm analog pads",
] as const;

type ApiKeyStatus = {
  hasKey: boolean;
  hint: string | null;
  addedAt: string | null;
};

type Overview = {
  activeSession?: Session & {
    // Host-only Station ID settings (the public snapshot exposes only enabled).
    stationIdEnabled?: boolean;
    stationIdPersonalize?: boolean;
    stationIdHostName?: string | null;
  };
  queue: QueueSnapshot;
  recent: QueueItem[];
  files: QueueItem[];
  sessions: Session[];
  apiKey: ApiKeyStatus;
};

type HostUser = {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
};

type RequestAction =
  | "approve"
  | "reject"
  | "retry"
  | "mark_played"
  | "remove_from_queue"
  | "add_to_queue";

type BulkAction = "delete" | "remove_from_queue" | "add_to_queue" | "approve";

/** Build a safe filename from a user-provided prompt. */
// Prefer the AI-generated song title; fall back to the prompt only before a
// title exists (e.g. while still pending/generating). Full prompt lives in the
// track detail modal.
function trackName(item: { title: string | null; prompt: string }): string {
  return item.title?.trim() || item.prompt;
}

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

export function HostConsole({ user }: { user: HostUser }) {
  // Two decks so the host's local player crossfades exactly like the stage.
  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);
  const { resume, setDeckGain, crossfade } = useStageAudio(audioARef, audioBRef);

  const [activeDeck, setActiveDeck] = useState<Deck>("a");
  const activeDeckRef = useRef<Deck>("a");
  useEffect(() => {
    activeDeckRef.current = activeDeck;
  }, [activeDeck]);
  const deckEl = useCallback(
    (d: Deck) => (d === "a" ? audioARef.current : audioBRef.current),
    []
  );
  const activeEl = useCallback(() => deckEl(activeDeckRef.current), [deckEl]);
  const crossfadingRef = useRef(false);

  // ── Session link regeneration ────────────────────────────────
  const [regenerating, setRegenerating] = useState(false);

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
  const [sessionsModalOpen, setSessionsModalOpen] = useState(false);
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

  // ── Host prompt composer ─────────────────────────────────────
  const [hostPrompt, setHostPrompt] = useState("");
  const [hostName, setHostName] = useState("Host");
  const [hostInstrumental, setHostInstrumental] = useState(false);
  const [hostIdeasOpen, setHostIdeasOpen] = useState(false);
  const [hostSubmitting, setHostSubmitting] = useState(false);
  // In-flight host-authored track: tracks the submission so we can show live
  // generation progress under the composer until it lands in the queue.
  const [hostJob, setHostJob] = useState<{
    requestId: string;
    clientToken: string;
  } | null>(null);
  const [hostJobItem, setHostJobItem] = useState<QueueItem | null>(null);

  // Cookie-based Neon Auth — no Authorization header needed; the host session
  // travels with the request. Kept as an empty object so the existing
  // `...authHeader` spreads on fetches stay valid.
  const authHeader = useMemo<Record<string, string>>(() => ({}), []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/overview", {
        headers: authHeader,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = "/sign-in?redirect=/host";
        } else {
          setError(body?.message || "Console overview unavailable.");
        }
        return;
      }
      setOverview(body as Overview);
      setError(null);
    } catch {
      setError("Network error reaching the console.");
    }
  }, [authHeader]);

  useRealtimeRefresh(refresh);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Keep the public request link + QR in sync with the active session's code.
  useEffect(() => {
    const code = overview?.activeSession?.publicCode;
    if (code) {
      setRequestLink(`${window.location.origin}/request?code=${code}`);
    } else {
      setRequestLink("");
    }
  }, [overview?.activeSession?.publicCode]);

  async function signOut() {
    try {
      await authClient.signOut();
    } catch {
      /* ignore */
    }
    window.location.href = "/sign-in";
  }

  const regenerateLink = useCallback(async () => {
    if (
      !window.confirm(
        "Generate a new request link? The current link and QR code will stop working immediately."
      )
    ) {
      return;
    }
    setRegenerating(true);
    try {
      const response = await fetch("/api/admin/sessions/regenerate", {
        method: "POST",
        headers: authHeader,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Could not regenerate the link.");
        return;
      }
      await refresh();
    } catch {
      setError("Network error regenerating the link.");
    } finally {
      setRegenerating(false);
    }
  }, [authHeader, refresh]);

  // ── Derived data ─────────────────────────────────────────────
  // The interleaved queue (real songs + station-ID jingles) for display only.
  const displayItems = useMemo(
    () =>
      (overview?.queue.items ?? []).filter(
        (item) => item.status === "ready" && item.audioUrl
      ),
    [overview]
  );

  // Real songs only — everything interactive (reorder, select, remove, advance,
  // counts) operates on these so virtual jingles can't be dragged or deleted.
  const readyItems = useMemo(
    () => displayItems.filter((item) => item.kind !== "station_id"),
    [displayItems]
  );

  const stationIdEnabled = overview?.queue.stationIdEnabled ?? false;
  const crossfadeEnabled = overview?.queue.crossfadeEnabled ?? false;

  // Requests awaiting host approval (approval mode), oldest first.
  const pendingItems = useMemo(
    () =>
      (overview?.queue.items ?? []).filter((item) => item.status === "pending"),
    [overview]
  );

  const sessions = useMemo(() => overview?.sessions ?? [], [overview]);
  const activeSession = useMemo(
    () =>
      overview?.activeSession ??
      sessions.find((session) => session.isActive) ??
      null,
    [overview?.activeSession, sessions]
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

  // ── Station ID playback (host-local only) ────────────────────
  // When no stage is connected, the host is the speaker, so it plays the
  // interleaved jingles itself — same model as the stage. While a stage IS
  // connected, playback (and jingles) live there and this stays dormant.
  const [activeStationId, setActiveStationId] = useState<QueueItem | null>(null);
  const stationReturnRef = useRef<string | null>(null);
  const [stationArmed, setStationArmed] = useState(false);
  const prevStationEnabledRef = useRef<boolean | null>(null);
  const isPlayingRef = useRef(false);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // What the host's <audio> actually plays: a jingle when one is in flight,
  // else the real current track. Queue/advance logic stays on `current`.
  const nowPlaying = activeStationId ?? current;

  const leadStationId = useCallback((): QueueItem | null => {
    if (!current) {
      const head = displayItems[0];
      return head?.kind === "station_id" ? head : null;
    }
    const idx = displayItems.findIndex((item) => item.id === current.id);
    const before = idx > 0 ? displayItems[idx - 1] : null;
    return before?.kind === "station_id" ? before : null;
  }, [current, displayItems]);

  const stationIdAfter = useCallback(
    (songId: string | null | undefined): QueueItem | null => {
      if (!songId) {
        return null;
      }
      const idx = displayItems.findIndex((item) => item.id === songId);
      const next = idx >= 0 ? displayItems[idx + 1] : null;
      return next?.kind === "station_id" ? next : null;
    },
    [displayItems]
  );

  // Archive a finished jingle + warm a fresh one. Host uses cookie auth, so the
  // request just needs same-origin credentials (authHeader is empty).
  const consumeStationId = useCallback(
    (id: string) => {
      fetch("/api/admin/station-id", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ id }),
      }).catch(() => {
        /* best-effort */
      });
    },
    [authHeader]
  );

  // Arm the lead jingle when station IDs are toggled on while stopped (consumed
  // by the next play). Not on pause/resume. Dormant while a stage drives audio.
  useEffect(() => {
    const prev = prevStationEnabledRef.current;
    prevStationEnabledRef.current = stationIdEnabled;
    if (stageConnectedRef.current) {
      return;
    }
    if (prev === false && stationIdEnabled) {
      setStationArmed(!isPlayingRef.current);
    } else if (prev && !stationIdEnabled) {
      setStationArmed(false);
    }
  }, [stationIdEnabled]);

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
        setIsPlaying(false);
        return;
      }
      setStageConnected(true);
      if (st.type === "hello") {
        // A stage just came online — silence local audio and hand off.
        audioARef.current?.pause();
        audioBRef.current?.pause();
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
        setIsPlaying(false);
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

  // ── Host prompt composer ─────────────────────────────────────
  // Spin a track straight into the live queue from the console. Hits the
  // admin-only endpoint, which skips the public open/rate-limit gates and
  // queues immediately (no approval step, even in approval mode).
  const submitHostPrompt = useCallback(async () => {
    const prompt = hostPrompt.trim();
    if (prompt.length < 10 || hostSubmitting) {
      return;
    }
    setHostSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          prompt,
          requesterName: hostName.trim() || "Host",
          instrumental: hostInstrumental,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Could not add your track.");
        return;
      }
      setHostPrompt("");
      if (body?.requestId && body?.clientToken) {
        setHostJobItem(null);
        setHostJob({ requestId: body.requestId, clientToken: body.clientToken });
      }
      await refresh();
    } catch {
      setError("Network error sending your track.");
    } finally {
      setHostSubmitting(false);
    }
  }, [authHeader, hostInstrumental, hostName, hostPrompt, hostSubmitting, refresh]);

  // Poll the in-flight host track's status so the composer can show live
  // progress (queued → generating → ready), then auto-dismiss once it lands.
  useEffect(() => {
    if (!hostJob) {
      return;
    }
    let cancelled = false;
    let hideTimer: number | undefined;

    async function poll() {
      try {
        const res = await fetch(
          `/api/requests/${hostJob!.requestId}?token=${encodeURIComponent(
            hostJob!.clientToken
          )}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) {
          return;
        }
        const item = (await res.json()) as QueueItem;
        if (cancelled) {
          return;
        }
        setHostJobItem(item);
        const terminal =
          item.status === "ready" ||
          item.status === "played" ||
          item.status === "archived" ||
          item.status === "failed" ||
          item.status === "rejected";
        if (terminal) {
          window.clearInterval(interval);
          hideTimer = window.setTimeout(() => {
            if (!cancelled) {
              setHostJob(null);
              setHostJobItem(null);
            }
          }, 6000);
        }
      } catch {
        /* keep last known state, try again next tick */
      }
    }

    const interval = window.setInterval(poll, 3000);
    poll();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (hideTimer) {
        window.clearTimeout(hideTimer);
      }
    };
  }, [hostJob]);

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

  const [togglingStationId, setTogglingStationId] = useState(false);
  const [togglingCrossfade, setTogglingCrossfade] = useState(false);
  const toggleStationId = useCallback(async () => {
    const next = !(overview?.queue.stationIdEnabled ?? false);
    setTogglingStationId(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ stationIdEnabled: next }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Could not update Station ID.");
        return;
      }
      await refresh();
    } catch {
      setError("Network error updating Station ID.");
    } finally {
      setTogglingStationId(false);
    }
  }, [authHeader, refresh, overview]);

  const toggleCrossfade = useCallback(async () => {
    const next = !(overview?.queue.crossfadeEnabled ?? false);
    setTogglingCrossfade(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ crossfadeEnabled: next }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Could not update crossfade.");
        return;
      }
      await refresh();
    } catch {
      setError("Network error updating crossfade.");
    } finally {
      setTogglingCrossfade(false);
    }
  }, [authHeader, refresh, overview]);

  const toggleStationIdPersonalize = useCallback(async () => {
    const next = !(overview?.activeSession?.stationIdPersonalize ?? false);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ stationIdPersonalize: next }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Could not update Station ID name.");
        return;
      }
      await refresh();
    } catch {
      setError("Network error updating Station ID name.");
    }
  }, [authHeader, refresh, overview]);

  const [savingStationName, setSavingStationName] = useState(false);
  const saveStationIdHostName = useCallback(
    async (value: string) => {
      if (value === (overview?.activeSession?.stationIdHostName ?? "")) {
        return; // unchanged — skip the round-trip
      }
      setSavingStationName(true);
      try {
        const response = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ stationIdHostName: value }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(body?.message || "Could not save the Station ID name.");
          return;
        }
        await refresh();
      } catch {
        setError("Network error saving the Station ID name.");
      } finally {
        setSavingStationName(false);
      }
    },
    [authHeader, refresh, overview]
  );

  // ── Master volume ────────────────────────────────────────────
  // While dragging we hold a local value so the slider stays responsive; the
  // committed value is POSTed on release and the snapshot becomes the source of
  // truth again (pending cleared). The stage screen obeys it on its next poll.
  const [pendingVolume, setPendingVolume] = useState<number | null>(null);
  const commitMasterVolume = useCallback(
    async (value: number) => {
      const clamped = Math.min(1, Math.max(0, value));
      try {
        const response = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ masterVolume: clamped }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(body?.message || "Could not update the volume.");
          return;
        }
        await refresh();
      } catch {
        setError("Network error updating the volume.");
      } finally {
        setPendingVolume(null);
      }
    },
    [authHeader, refresh]
  );

  // ── ElevenLabs API key management ────────────────────────────
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [removingKey, setRemovingKey] = useState(false);

  const removeApiKey = useCallback(async () => {
    if (
      !window.confirm(
        "Remove your ElevenLabs key? New tracks won't generate until you reconnect one."
      )
    ) {
      return;
    }
    setRemovingKey(true);
    try {
      const response = await fetch("/api/admin/api-key", {
        method: "DELETE",
        headers: authHeader,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || "Could not remove your key.");
        return;
      }
      await refresh();
    } catch {
      setError("Network error removing your key.");
    } finally {
      setRemovingKey(false);
    }
  }, [authHeader, refresh]);

  // ── Orb colorway picker ──────────────────────────────────────
  const [orbPickerOpen, setOrbPickerOpen] = useState(false);
  const [settingOrb, setSettingOrb] = useState<string | null>(null);

  const chooseOrbColorway = useCallback(
    async (name: string) => {
      if (name === (overview?.queue.orbColorway ?? "creative-1")) {
        setOrbPickerOpen(false);
        return;
      }
      setSettingOrb(name);
      try {
        const response = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ orbColorway: name }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setError(body?.message || "Could not update the orb.");
          return;
        }
        await refresh();
        setOrbPickerOpen(false);
      } catch {
        setError("Network error updating the orb.");
      } finally {
        setSettingOrb(null);
      }
    },
    [authHeader, overview?.queue.orbColorway, refresh]
  );

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
  }, [authHeader, current?.id, isPlaying, stageConnected]);

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
    // Armed (station IDs enabled while stopped) → open with the lead jingle.
    // Consumed once; the [nowPlaying?.id] effect then plays it.
    if (stationArmed && !activeStationId) {
      setStationArmed(false);
      const lead = leadStationId();
      if (lead) {
        stationReturnRef.current = null;
        setActiveStationId(lead);
        setIsPlaying(true);
        return;
      }
    }
    const audio = activeEl();
    if (!audio || !nowPlaying?.audioUrl) {
      return;
    }
    if (audio.src !== nowPlaying.audioUrl) {
      audio.src = nowPlaying.audioUrl;
    }
    if (!crossfadingRef.current) {
      setDeckGain(activeDeckRef.current, 1);
      setDeckGain(activeDeckRef.current === "a" ? "b" : "a", 0);
    }
    try {
      await audio.play();
      resume();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }, [
    current,
    nowPlaying,
    sendCmd,
    stationArmed,
    activeStationId,
    leadStationId,
    activeEl,
    setDeckGain,
    resume,
  ]);

  const pauseCurrent = useCallback(() => {
    if (stageConnectedRef.current) {
      sendCmd("pause");
      return;
    }
    audioARef.current?.pause();
    audioBRef.current?.pause();
    setIsPlaying(false);
  }, [sendCmd]);

  // Manually drop a Radio ID jingle in now (clicked from the queue). On the
  // stage it's a select command (the stage resolves the pool id); locally we
  // play the jingle on the active deck and resume the set when it ends.
  const playStationId = useCallback(
    (item: QueueItem) => {
      const sourceId = item.stationSourceId ?? item.id;
      if (stageConnectedRef.current) {
        sendCmd("select", sourceId);
        return;
      }
      stationReturnRef.current = isPlaying ? current?.id ?? null : null;
      setActiveStationId(item);
      setIsPlaying(true);
    },
    [sendCmd, isPlaying, current]
  );

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

  // A jingle finished, or a song finished with a jingle queued next: play the
  // jingle, else advance. Mirrors the stage; jingles are archived (not marked
  // played) and resume to the right song.
  const handleTrackEnded = useCallback(() => {
    if (activeStationId) {
      consumeStationId(activeStationId.stationSourceId ?? activeStationId.id);
      const wasLead = stationReturnRef.current === null;
      stationReturnRef.current = null;
      setActiveStationId(null);
      if (wasLead) {
        // Lead jingle → play the current top track itself (don't skip it).
        setIsPlaying(Boolean(current));
      } else {
        advance(true);
      }
      return;
    }
    const sid = stationIdEnabled ? stationIdAfter(current?.id) : null;
    if (sid) {
      stationReturnRef.current = current?.id ?? null;
      setIsPlaying(false);
      setActiveStationId(sid);
      setIsPlaying(true);
      return;
    }
    advance(true);
  }, [
    activeStationId,
    advance,
    consumeStationId,
    current,
    stationIdEnabled,
    stationIdAfter,
  ]);

  // ── Crossfade (same engine as the stage) ─────────────────────
  const peekNext = useCallback((): QueueItem | null => {
    if (activeStationId) {
      const fromId = stationReturnRef.current;
      if (!fromId) {
        return readyItems[0] ?? null;
      }
      const i = readyItems.findIndex((s) => s.id === fromId);
      return readyItems[i + 1] ?? null;
    }
    const sid = stationIdEnabled ? stationIdAfter(current?.id) : null;
    if (sid) {
      return sid;
    }
    const i = readyItems.findIndex((s) => s.id === current?.id);
    return readyItems[i + 1] ?? null;
  }, [activeStationId, readyItems, stationIdEnabled, stationIdAfter, current]);

  const commitNext = useCallback(
    (next: QueueItem) => {
      if (next.kind === "station_id") {
        stationReturnRef.current = current?.id ?? null;
        setActiveStationId(next);
        return;
      }
      if (activeStationId) {
        consumeStationId(
          activeStationId.stationSourceId ?? activeStationId.id
        );
        stationReturnRef.current = null;
        setActiveStationId(null);
      } else if (current?.id) {
        // Song → song: mark the finished song played (host semantics).
        void runAction(current.id, "mark_played");
      }
      setCurrentId(next.id);
    },
    [activeStationId, consumeStationId, current, runAction]
  );

  const beginCrossfade = useCallback(
    (next: QueueItem, fadeSec: number) => {
      if (!next.audioUrl) {
        return;
      }
      const from = activeDeckRef.current;
      const to: Deck = from === "a" ? "b" : "a";
      const toEl = deckEl(to);
      if (!toEl) {
        return;
      }
      crossfadingRef.current = true;
      toEl.src = next.audioUrl;
      try {
        toEl.currentTime = 0;
      } catch {
        /* not yet seekable */
      }
      setDeckGain(to, 0.0001);
      void toEl
        .play()
        .then(() => resume())
        .catch(() => undefined);
      crossfade(from, to, fadeSec);

      activeDeckRef.current = to;
      setActiveDeck(to);
      commitNext(next);

      window.setTimeout(
        () => {
          const oldEl = deckEl(from);
          if (oldEl) {
            oldEl.pause();
          }
          setDeckGain(from, 0);
          crossfadingRef.current = false;
        },
        fadeSec * 1000 + 250
      );
    },
    [deckEl, setDeckGain, crossfade, resume, commitNext]
  );

  const crossfadeCtlRef = useRef({
    enabled: false,
    peek: (() => null) as () => QueueItem | null,
    begin: (_next: QueueItem, _fadeSec: number) => {},
  });
  useEffect(() => {
    crossfadeCtlRef.current = {
      enabled: crossfadeEnabled,
      peek: peekNext,
      begin: beginCrossfade,
    };
  });

  // Arm the crossfade as the active deck nears its end (host-local only).
  useEffect(() => {
    if (!isPlaying || stageConnectedRef.current) {
      return;
    }
    let raf = 0;
    const tick = () => {
      const audio = activeEl();
      const cf = crossfadeCtlRef.current;
      if (audio && cf.enabled && !crossfadingRef.current) {
        const dur = audio.duration;
        if (Number.isFinite(dur) && dur > 0) {
          const fadeSec = Math.min(HOST_CROSSFADE_SEC, dur * 0.4);
          const remaining = dur - audio.currentTime;
          if (remaining <= fadeSec && remaining > 0.08) {
            const next = cf.peek();
            if (next?.audioUrl && next.audioUrl !== audio.src) {
              cf.begin(next, fadeSec);
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, activeEl]);

  // When what's playing changes (song or jingle) while we intend to keep
  // playing, (re)start it. Keyed on nowPlaying so switching to/from a jingle
  // triggers playback. Skipped while a stage is connected or mid-crossfade.
  useEffect(() => {
    if (stageConnectedRef.current || crossfadingRef.current) {
      return;
    }
    if (isPlaying) {
      playCurrent().catch(() => setIsPlaying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlaying?.id]);

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
      anchor.download = `${slugify(trackName(item))}.mp3`;
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

  // ── Console ──────────────────────────────────────────────────
  const counts = overview?.queue.counts;
  const requestsOpen = overview?.queue.requestsOpen ?? true;

  const autoDj = overview?.queue.autoDj ?? true;

  const stationIdPersonalize =
    overview?.activeSession?.stationIdPersonalize ?? false;
  const stationIdHostName = overview?.activeSession?.stationIdHostName ?? "";

  const orbColorway = overview?.queue.orbColorway ?? "creative-1";
  const currentColorway = resolveColorway(orbColorway);

  // Live master volume — the pending drag value wins while the slider is held.
  const masterVolume = pendingVolume ?? overview?.queue.masterVolume ?? 1;
  const masterVolumePct = Math.round(masterVolume * 100);

  // ── ElevenLabs API key ───────────────────────────────────────
  // Non-admin hosts must connect their own key before they can use the console.
  // Admins fall back to the shared app key, so they're never gated.
  const apiKey = overview?.apiKey;
  const needsKeySetup = Boolean(overview) && !user.isAdmin && !apiKey?.hasKey;

  const hostRemaining = 800 - hostPrompt.length;
  const hostTrimmed = hostPrompt.trim();
  const canHostSubmit =
    hostTrimmed.length >= 10 && hostRemaining >= 0 && !hostSubmitting;

  // Live progress for the host's in-flight track (null when nothing is cooking).
  const hostJobStatus = hostJobItem?.status;
  const hostJobFailed =
    hostJobStatus === "failed" || hostJobStatus === "rejected";
  const hostJobDone =
    hostJobStatus === "ready" ||
    hostJobStatus === "played" ||
    hostJobStatus === "archived";
  const hostJobStep = hostJobFailed
    ? -1
    : hostJobStatus === "generating"
      ? 1
      : hostJobDone
        ? 2
        : 0;
  const hostJobMessage = !hostJobItem
    ? "Sending your track…"
    : hostJobFailed
      ? hostJobItem.promptSuggestion ||
        hostJobItem.errorMessage ||
        "That track couldn’t be generated."
      : hostJobDone
        ? "Song finished and added to the queue."
        : hostJobStatus === "generating"
          ? "Generating your track now…"
          : "Queued — generating shortly…";

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
            <HostTourButton userId={user.id} autoStart={!needsKeySetup} />
            <button
              type="button"
              id="tour-stage-button"
              onClick={() =>
                window.open(
                  activeSession?.publicCode
                    ? `/stage?code=${activeSession.publicCode}`
                    : "/stage",
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
              onClick={() => setOrbPickerOpen(true)}
              className="btn-ghost inline-flex h-9 items-center gap-2 px-3.5 text-sm"
              title="Choose the stage orb color"
            >
              <span
                className="size-4 shrink-0 rounded-full ring-1 ring-black/10"
                style={{
                  backgroundImage: `url(${currentColorway.src})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
                aria-hidden
              />
              Orb
            </button>
            <button
              type="button"
              onClick={() => setSessionsModalOpen(true)}
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
              onClick={refresh}
              className="btn-ghost inline-flex h-9 items-center gap-2 px-3 text-sm"
              title="Refresh"
            >
              <RefreshCcw size={15} />
            </button>
            <button
              type="button"
              onClick={signOut}
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

      {/* Working area — multi-column to use the viewport */}
      <div className="mt-4 grid gap-4 lg:grid-cols-12 lg:items-start">
        {/* Left column — controls + transport */}
        <div className="space-y-4 lg:col-span-4">
          {/* DJ booth — host spins a track straight into the queue */}
          <section id="tour-dj-booth" className="card rise overflow-hidden p-0">
            <div className="flex items-center gap-2.5 bg-[var(--graphite)] px-4 py-3 sm:px-5">
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--off-white)]"
                style={{ background: "rgba(255,255,255,0.12)" }}
              >
                <Wand2 size={15} />
              </span>
              <div className="min-w-0">
                <p
                  className="text-sm font-semibold text-[var(--off-white)]"
                  style={{ fontFamily: "var(--font-brand)" }}
                >
                  DJ booth
                </p>
                <p
                  className="truncate text-[11px]"
                  style={{ color: "rgba(255,255,255,0.6)" }}
                >
                  Spin your own track straight into the queue
                </p>
              </div>
            </div>

            <div className="p-4 sm:p-5">
              <label className="block">
                <span className="eyebrow mb-2 flex items-center justify-between gap-3">
                  <span>Prompt</span>
                  <span
                    className={`mono text-xs ${
                      hostRemaining < 0
                        ? "text-[var(--destructive)]"
                        : "text-[var(--mid-gray)]"
                    }`}
                  >
                    {hostRemaining}
                  </span>
                </span>
                <textarea
                  value={hostPrompt}
                  onChange={(event) => setHostPrompt(event.target.value)}
                  maxLength={800}
                  rows={3}
                  className="control min-h-[92px] w-full resize-none rounded-[var(--radius-lg)] p-3.5 text-sm leading-6"
                  placeholder="Driving peak-time tech house with a deep rolling bassline and a big filtered build"
                  onKeyDown={(event) => {
                    if (
                      (event.metaKey || event.ctrlKey) &&
                      event.key === "Enter"
                    ) {
                      event.preventDefault();
                      void submitHostPrompt();
                    }
                  }}
                />
              </label>

              {/* Quick ideas — collapsed by default to save space */}
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setHostIdeasOpen((open) => !open)}
                  aria-expanded={hostIdeasOpen}
                  className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--mid-gray)] transition hover:text-[var(--graphite)]"
                >
                  <ChevronDown
                    size={12}
                    className={`shrink-0 transition-transform ${hostIdeasOpen ? "rotate-180" : ""}`}
                  />
                  Quick ideas
                </button>
                {hostIdeasOpen && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {HOST_IDEAS.map((idea) => (
                      <button
                        key={idea}
                        type="button"
                        onClick={() => setHostPrompt(idea)}
                        className="rounded-full border border-[var(--light-gray)] bg-[var(--white)] px-2 py-0.5 text-[10px] leading-snug text-[var(--dark-gray)] transition hover:border-[var(--graphite)] hover:text-[var(--graphite)]"
                      >
                        {idea}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Credit name + instrumental */}
              <div className="mt-3 flex items-center gap-2">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Credit name</span>
                  <input
                    value={hostName}
                    onChange={(event) => setHostName(event.target.value)}
                    maxLength={40}
                    className="control h-10 w-full px-3 text-sm"
                    placeholder="Host"
                  />
                </label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={hostInstrumental}
                  onClick={() => setHostInstrumental((value) => !value)}
                  title="Instrumental only"
                  className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border px-3 text-xs font-medium transition ${
                    hostInstrumental
                      ? "border-[var(--graphite)] bg-[var(--graphite)] text-[var(--off-white)]"
                      : "border-[var(--light-gray)] bg-[var(--white)] text-[var(--dark-gray)] hover:border-[var(--graphite)]"
                  }`}
                >
                  <Music2 size={14} />
                  Instrumental
                </button>
              </div>

              <button
                type="button"
                onClick={submitHostPrompt}
                disabled={!canHostSubmit}
                className="btn-primary mt-3 inline-flex h-11 w-full items-center justify-center gap-2 text-sm"
              >
                {hostSubmitting ? (
                  <Disc3 className="animate-spin" size={17} />
                ) : (
                  <Sparkles size={17} />
                )}
                {hostSubmitting ? "Spinning up…" : "Drop into queue"}
              </button>

              {hostJob ? (
                <div
                  className={`rise mt-3 rounded-[var(--radius-md)] border p-3 ${
                    hostJobFailed
                      ? "border-[var(--destructive)] bg-[rgba(180,35,24,0.05)]"
                      : hostJobDone
                        ? "border-[var(--graphite)] bg-[var(--cream)]"
                        : "border-[var(--light-gray)] bg-[var(--white)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                        hostJobFailed
                          ? "bg-[var(--destructive)] text-[var(--off-white)]"
                          : hostJobDone
                            ? "bg-[var(--graphite)] text-[var(--off-white)]"
                            : "bg-[var(--light-gray)] text-[var(--graphite)]"
                      }`}
                    >
                      {hostJobFailed ? (
                        <X size={13} />
                      ) : hostJobDone ? (
                        <Check size={13} />
                      ) : (
                        <Disc3 size={13} className="animate-spin" />
                      )}
                    </span>
                    <p className="min-w-0 flex-1 text-xs font-medium text-[var(--graphite)]">
                      {hostJobMessage}
                    </p>
                  </div>

                  {!hostJobFailed && (
                    <div className="mt-2.5 flex gap-1">
                      {["Queued", "Generating", "Ready"].map((label, index) => {
                        const reached = hostJobStep >= index;
                        const active = hostJobStep === index && !hostJobDone;
                        return (
                          <div key={label} className="flex-1">
                            <div
                              className={`h-1 rounded-full transition-colors ${
                                reached
                                  ? "bg-[var(--graphite)]"
                                  : "bg-[var(--light-gray)]"
                              } ${active ? "animate-pulse" : ""}`}
                            />
                            <span className="mt-1 block text-[9px] uppercase tracking-[0.12em] text-[var(--mid-gray)]">
                              {label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : hostTrimmed.length > 0 && hostTrimmed.length < 10 ? (
                <p className="mt-2.5 text-xs text-[var(--mid-gray)]">
                  A few more words — at least 10 characters.
                </p>
              ) : (
                <p className="mt-2.5 text-[11px] text-[var(--mid-gray)]">
                  Queues instantly, even with the line paused or in approval
                  mode. <span className="mono">⌘↵</span> to send.
                </p>
              )}
            </div>
          </section>

          {/* Controls — request line, AutoDJ, public link */}
          <section className="card rise p-4 sm:p-5">
            {/* Request line toggle */}
            <div
              id="tour-request-line"
              className="card-soft flex items-center justify-between gap-3 p-4"
            >
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
            <div
              id="tour-autodj"
              className="card-soft mt-3 flex items-center justify-between gap-3 p-4"
            >
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

            {/* Station ID — auto radio-ID jingle every couple of songs */}
            <div className="card-soft mt-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="eyebrow">Station ID</p>
                  <p className="mt-1 text-sm text-[var(--dark-gray)]">
                    {stationIdEnabled
                      ? "On — a ~10s radio ID plays every 2 songs."
                      : "Off — no station IDs between songs."}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={stationIdEnabled}
                  disabled={togglingStationId}
                  onClick={toggleStationId}
                  title={
                    stationIdEnabled
                      ? "Turn Station ID off"
                      : "Turn Station ID on"
                  }
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                    stationIdEnabled
                      ? "bg-[var(--graphite)]"
                      : "bg-[var(--light-gray)]"
                  }`}
                >
                  <span
                    className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
                      stationIdEnabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {stationIdEnabled ? (
                <div className="mt-4 border-t border-[var(--light-gray)] pt-4">
                  <label className="flex items-center gap-2 text-sm text-[var(--dark-gray)]">
                    <input
                      type="checkbox"
                      checked={stationIdPersonalize}
                      onChange={toggleStationIdPersonalize}
                      className="size-4 accent-[var(--graphite)]"
                    />
                    Personalize with my name
                  </label>
                  <input
                    type="text"
                    // Re-keyed on the saved value so it re-seeds when the server
                    // value changes, but stays uncontrolled while typing.
                    key={stationIdHostName}
                    defaultValue={stationIdHostName}
                    disabled={!stationIdPersonalize || savingStationName}
                    maxLength={60}
                    placeholder="e.g. DJ Jake, or your room name"
                    onBlur={(event) =>
                      saveStationIdHostName(event.currentTarget.value.trim())
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    className="mt-2 w-full rounded-lg border border-[var(--light-gray)] bg-white px-3 py-2 text-sm disabled:opacity-50"
                  />
                  <p className="mt-2 text-xs text-[var(--mid-gray)]">
                    {stationIdPersonalize
                      ? "Woven into the jingle, e.g. “DJ Jake on ElevenDJ Radio, powered by ElevenLabs.”"
                      : "Off — stays the high-level “ElevenDJ Radio, powered by ElevenLabs.”"}
                  </p>
                </div>
              ) : null}
            </div>

            {/* Crossfade — radio-style overlap between tracks on the stage */}
            <div className="card-soft mt-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="eyebrow">Crossfade</p>
                  <p className="mt-1 text-sm text-[var(--dark-gray)]">
                    {crossfadeEnabled
                      ? "On — tracks blend into each other on the stage."
                      : "Off — tracks hard-cut to the next."}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={crossfadeEnabled}
                  disabled={togglingCrossfade}
                  onClick={toggleCrossfade}
                  title={
                    crossfadeEnabled ? "Turn crossfade off" : "Turn crossfade on"
                  }
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                    crossfadeEnabled
                      ? "bg-[var(--graphite)]"
                      : "bg-[var(--light-gray)]"
                  }`}
                >
                  <span
                    className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
                      crossfadeEnabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Master volume — host-controlled room level; the stage obeys it */}
            <div
              id="tour-master-volume"
              className="card-soft mt-3 flex items-center gap-4 p-4"
            >
              <button
                type="button"
                onClick={() =>
                  commitMasterVolume(masterVolume === 0 ? 1 : 0)
                }
                className="text-[var(--dark-gray)] transition-colors hover:text-[var(--graphite)]"
                aria-label={masterVolume === 0 ? "Unmute room" : "Mute room"}
                title={masterVolume === 0 ? "Unmute room" : "Mute room"}
              >
                {masterVolume === 0 ? (
                  <VolumeX size={20} />
                ) : masterVolume < 0.5 ? (
                  <Volume1 size={20} />
                ) : (
                  <Volume2 size={20} />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p className="eyebrow">Master volume</p>
                  <span className="text-sm tabular-nums text-[var(--dark-gray)]">
                    {masterVolumePct}%
                  </span>
                </div>
                <SliderPrimitive.Root
                  className="relative mt-2 flex h-5 w-full touch-none select-none items-center"
                  value={[masterVolume]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={(vals) => setPendingVolume(vals[0] ?? 0)}
                  onValueCommit={(vals) => commitMasterVolume(vals[0] ?? 0)}
                  aria-label="Master volume"
                >
                  <SliderPrimitive.Track className="relative h-1.5 grow rounded-full bg-[var(--light-gray)]">
                    <SliderPrimitive.Range className="absolute h-full rounded-full bg-[var(--graphite)]" />
                  </SliderPrimitive.Track>
                  <SliderPrimitive.Thumb className="block size-4 rounded-full bg-white shadow ring-1 ring-[var(--light-gray)] transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--graphite)]" />
                </SliderPrimitive.Root>
                <p className="mt-1 text-xs text-[var(--dark-gray)]">
                  Sets the playback level on the stage screen.
                </p>
              </div>
            </div>

            {/* Public request link + QR (unique to this session) */}
            <div
              id="tour-public-link"
              className="card-soft mt-3 flex flex-col gap-3 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="eyebrow">Public request link</p>
                  <p className="mono mt-1 truncate text-sm text-[var(--dark-gray)]">
                    {requestLink || "Starting your session…"}
                  </p>
                </div>
                {requestLink ? (
                  <div className="shrink-0 rounded-[var(--radius-md)] bg-white p-1.5 ring-1 ring-[var(--light-gray)]">
                    <QRCodeSVG value={requestLink} size={84} marginSize={0} />
                  </div>
                ) : null}
              </div>
              <p className="text-[11px] text-[var(--mid-gray)]">
                Unique to this session — scanning the QR opens your request line.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyLink}
                  disabled={!requestLink}
                  className="btn-ghost inline-flex h-10 shrink-0 items-center justify-center gap-2 px-4 text-sm"
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? "Copied" : "Copy link"}
                </button>
                <button
                  type="button"
                  onClick={regenerateLink}
                  disabled={regenerating || !requestLink}
                  className="btn-ghost inline-flex h-10 shrink-0 items-center justify-center gap-2 px-4 text-sm"
                  title="Issue a new link + QR (the old one stops working)"
                >
                  <QrCode size={16} />
                  {regenerating ? "Regenerating…" : "New link"}
                </button>
              </div>
            </div>

            {/* ElevenLabs API key — host brings their own; generation is billed
                to their account. Admins fall back to the shared app key. */}
            <div
              id="tour-api-key"
              className="card-soft mt-3 flex flex-col gap-3 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="eyebrow flex items-center gap-1.5">
                    <KeyRound size={12} />
                    ElevenLabs key
                  </p>
                  {apiKey?.hasKey ? (
                    <p className="mt-1 text-sm text-[var(--dark-gray)]">
                      Connected{" "}
                      <span className="mono">{apiKey.hint}</span>
                      {apiKey.addedAt ? (
                        <span className="text-[var(--mid-gray)]">
                          {" · added "}
                          {formatDate(apiKey.addedAt)}
                        </span>
                      ) : null}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-[var(--dark-gray)]">
                      {user.isAdmin
                        ? "Using the shared app key. Add your own to bill generation to your account."
                        : "Connect your key to generate tracks."}
                    </p>
                  )}
                </div>
                {apiKey?.hasKey && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--light-gray)] bg-[var(--cream)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--graphite)]">
                    <span className="size-1.5 rounded-full bg-[var(--graphite)]" />
                    Connected
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setApiKeyModalOpen(true)}
                  className="btn-ghost inline-flex h-10 items-center justify-center gap-2 px-4 text-sm"
                >
                  <KeyRound size={15} />
                  {apiKey?.hasKey ? "Replace key" : "Add key"}
                </button>
                {apiKey?.hasKey && (
                  <button
                    type="button"
                    onClick={removeApiKey}
                    disabled={removingKey}
                    className="btn-danger inline-flex h-10 items-center justify-center gap-2 px-4 text-sm"
                  >
                    <Trash2 size={15} />
                    {removingKey ? "Removing…" : "Remove"}
                  </button>
                )}
              </div>
            </div>
          </section>

        </div>

        {/* Middle column — pending approvals + live queue */}
        <div className="space-y-4 lg:col-span-5">
          {/* Player — compact transport */}
          <section id="tour-player" className="card rise p-4 sm:p-5">
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
                  {current ? trackName(current) : "No ready track selected"}
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
                Audio plays from the stage tab — share that tab (with audio) in
                Zoom. These controls drive it.
              </p>
            ) : (
              <p className="mt-3 text-xs text-[var(--mid-gray)]">
                Playing locally on this device — use the transport controls
                above. Open a /stage tab for the big-screen player.
              </p>
            )}

            {/* Two hidden decks — local audio output with the same crossfade
                engine as the stage. Always mounted so the WebAudio graph exists;
                they only play when no stage is connected. */}
            {(["a", "b"] as Deck[]).map((deck) => (
              <audio
                key={deck}
                ref={deck === "a" ? audioARef : audioBRef}
                crossOrigin="anonymous"
                className="hidden"
                onPlay={() => {
                  if (
                    deck === activeDeckRef.current &&
                    !stageConnectedRef.current
                  ) {
                    setIsPlaying(true);
                  }
                }}
                onPause={() => {
                  if (
                    deck === activeDeckRef.current &&
                    !stageConnectedRef.current
                  ) {
                    setIsPlaying(false);
                  }
                }}
                onEnded={() => {
                  if (deck === activeDeckRef.current) handleTrackEnded();
                }}
              >
                <track kind="captions" />
              </audio>
            ))}
          </section>

          {/* Pending approval (shown in approval mode or whenever anything waits).
              The wrapper is always rendered so the onboarding tour has a stable
              anchor even when the panel itself is hidden. */}
          <div id="tour-approvals">
          {(!autoDj || pendingItems.length > 0) && (
            <section className="card rise p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-xl">
                  <Inbox size={18} />
                  Pending approval
                  <span className="mono text-sm font-normal text-[var(--mid-gray)]">
                    {pendingItems.length}
                  </span>
                </h2>
                {pendingItems.length > 0 && (
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() =>
                      runBulk(
                        "approve",
                        pendingItems.map((item) => item.id)
                      )
                    }
                    className="btn-primary inline-flex h-9 items-center gap-2 px-4 text-sm"
                    title="Approve every pending request"
                  >
                    <Check size={15} />
                    {bulkBusy
                      ? "Approving…"
                      : `Approve all (${pendingItems.length})`}
                  </button>
                )}
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
          </div>

          {/* Queue */}
          <section id="tour-queue" className="card rise p-4 sm:p-5">
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
          {displayItems.map((item, i) => {
            // Interleaved radio-ID jingle — read-only marker showing where it'll
            // drop in. Not draggable, selectable, or removable (it's virtual).
            if (item.kind === "station_id") {
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-2.5 rounded-md border border-dashed px-2.5 py-1.5 ${
                    activeStationId?.id === item.id
                      ? "border-[var(--graphite)] bg-[var(--graphite)]/[0.06]"
                      : "border-[var(--mid-gray)]/40 bg-[var(--graphite)]/[0.03]"
                  }`}
                >
                  <Radio
                    size={14}
                    className={`shrink-0 ${
                      activeStationId?.id === item.id
                        ? "text-[var(--graphite)]"
                        : "text-[var(--mid-gray)]"
                    }`}
                    aria-hidden
                  />
                  <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-[var(--mid-gray)]">
                    Radio ID
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-[var(--mid-gray)]">
                    {item.title && item.title !== "Radio ID"
                      ? item.title
                      : "Station jingle"}
                  </span>
                  {activeStationId?.id === item.id && (
                    <span className="shrink-0">
                      <AudioMeters active={isPlaying} />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => playStationId(item)}
                    className="btn-primary inline-flex size-8 shrink-0 items-center justify-center"
                    title="Play this Radio ID now"
                  >
                    <Play size={14} />
                  </button>
                </div>
              );
            }
            // Song rows keep their real-queue ordinal (jingles don't count).
            const index = displayItems
              .slice(0, i)
              .filter((x) => x.kind !== "station_id").length;
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
                    {trackName(item)}
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
          <section
            id="tour-files"
            className="card rise min-w-0 overflow-hidden p-4 sm:p-5"
          >
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
                    {trackName(item)}
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

      {/* First-run hard gate: a non-admin host can't use the console until they
          connect a valid key. Refresh on save clears `needsKeySetup`. */}
      {needsKeySetup && (
        <ApiKeySetupModal mode="gate" onSaved={refresh} />
      )}

      {/* Replace / add key from the management card (dismissible). */}
      {apiKeyModalOpen && !needsKeySetup && (
        <ApiKeySetupModal
          mode="manage"
          onSaved={refresh}
          onClose={() => setApiKeyModalOpen(false)}
        />
      )}

      <SessionsModal
        open={sessionsModalOpen}
        sessions={sessions}
        onClose={() => setSessionsModalOpen(false)}
        onChanged={refresh}
        onCreateSession={createSession}
        creatingSession={creatingSession}
      />

      {/* Orb colorway picker */}
      {orbPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOrbPickerOpen(false)}
        >
          <div
            className="card rise w-full max-w-lg p-5"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Stage orb color"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Palette size={16} />
                Stage orb
              </h2>
              <button
                type="button"
                onClick={() => setOrbPickerOpen(false)}
                className="btn-ghost inline-flex size-8 items-center justify-center"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mb-4 text-xs text-[var(--mid-gray)]">
              Pick the gradient for the orb on the stage screen. The background
              tints to match automatically.
            </p>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
              {COLORWAY_NAMES.map((name) => {
                const cw = COLORWAYS[name];
                const selected = name === orbColorway;
                const busy = settingOrb === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => chooseOrbColorway(name)}
                    disabled={!!settingOrb}
                    title={cw.label}
                    className={`flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] p-1.5 transition disabled:cursor-default ${
                      selected
                        ? "ring-2 ring-[var(--graphite)]"
                        : "hover:bg-[var(--cream)]"
                    }`}
                  >
                    <span
                      className="relative size-14 rounded-full ring-1 ring-black/10"
                      style={{
                        backgroundImage: `url(${cw.src})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    >
                      {busy && (
                        <span className="absolute inset-0 grid place-items-center rounded-full bg-black/30">
                          <Disc3
                            size={16}
                            className="animate-spin text-white"
                          />
                        </span>
                      )}
                      {selected && !busy && (
                        <span className="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full bg-[var(--graphite)] text-[var(--off-white)]">
                          <Check size={11} />
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] leading-tight text-[var(--dark-gray)]">
                      {cw.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
