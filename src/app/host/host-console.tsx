"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiKeySetupModal } from "@/components/api-key-setup-modal";
import { resolveColorway } from "@/components/orb/colorways";
import { SessionsModal } from "@/components/sessions-modal";
import { TrackDetailModal } from "@/components/track-detail-modal";
import { authClient } from "@/lib/auth/client";
import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import { useStageAudio, type Deck } from "@/lib/use-stage-audio";
import type { QueueItem, QueueSnapshot, Session } from "@/lib/status";

import { DjBooth } from "./dj-booth";
import { useApiKeyManager } from "./use-api-key-manager";
import { useFilesLibrary } from "./use-files-library";
import { useHostComposer } from "./use-host-composer";
import { useHostSettings } from "./use-host-settings";
import { useQueueActions } from "./use-queue-actions";
import { useQueueSelection } from "./use-queue-selection";
import { useSessionActions } from "./use-session-actions";
import { HostControlsPanel } from "./host-controls-panel";
import { HostFilesPanel } from "./host-files-panel";
import { HostHeader } from "./host-header";
import { HostPlayerCard } from "./host-player-card";
import { HostQueuePanel } from "./host-queue-panel";
import { OrbColorwayPicker } from "./orb-colorway-picker";
import { PendingApprovalsPanel } from "./pending-approvals-panel";
import { useOrbColorway } from "./use-orb-colorway";
import { useSessionLink } from "./use-session-link";

// Crossfade length on the host's local player — kept in sync with the stage.
const HOST_CROSSFADE_SEC = 3;
import {
  asStageStatus,
  createStageChannel,
  type HostAction,
} from "@/lib/stage-sync";

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
  const [sessionsModalOpen, setSessionsModalOpen] = useState(false);

  // Tracks the last now-playing state we published, so we only POST on change.
  const lastPublishedRef = useRef<string>("");

  // ── Selections ───────────────────────────────────────────────
  const { queueSel, setQueueSel, filesSel, setFilesSel, toggle } =
    useQueueSelection();


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

  // Public request link + QR (sync, copy, regenerate). Consumed by
  // <HostControlsPanel> as a grouped object.
  const sessionLink = useSessionLink({
    publicCode: overview?.activeSession?.publicCode,
    authHeader,
    refresh,
    onError: setError,
  });

  async function signOut() {
    try {
      await authClient.signOut();
    } catch {
      /* ignore */
    }
    window.location.href = "/sign-in";
  }

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
  // File library view (active-session files come from the polled overview;
  // past/all sessions fetch on demand) + per-file downloads.
  const {
    files,
    filesLoading,
    filesSessionId,
    onPickSession,
    refreshFilesView,
    resetFilesView,
    downloadFile,
    downloadSelected,
  } = useFilesLibrary({
    overviewFiles: overview?.files,
    authHeader,
    onError: setError,
    filesSel,
    setFilesSel,
  });

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
  // and mirror its playback state for display. Namespaced by session code.
  useEffect(() => {
    const publicCode = overview?.activeSession?.publicCode ?? null;
    const ch = createStageChannel(publicCode);
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
  }, [sendCmd, overview?.activeSession?.publicCode]);

  // ── Queue/request actions (mutations + busy flags) ───────────
  const {
    busyId,
    bulkBusy,
    reordering,
    runAction,
    deleteRow,
    reorder,
    runBulk,
  } = useQueueActions({ authHeader, refresh, onError: setError, setFilesSel });

  // ── Host prompt composer ─────────────────────────────────────
  // Spin a track straight into the live queue from the console. Hits the
  // admin-only endpoint, which skips the public open/rate-limit gates and
  // queues immediately (no approval step, even in approval mode).
  // Host DJ-booth composer (inputs + submit + in-flight job poll/progress).
  const {
    hostPrompt,
    setHostPrompt,
    hostName,
    setHostName,
    hostInstrumental,
    setHostInstrumental,
    hostIdeasOpen,
    setHostIdeasOpen,
    hostSubmitting,
    canHostSubmit,
    submitHostPrompt,
    hostJob,
    hostRemaining,
    hostTrimmed,
    hostJobFailed,
    hostJobDone,
    hostJobStep,
    hostJobMessage,
  } = useHostComposer({ authHeader, refresh, onError: setError });

  // ── ElevenLabs API key management ────────────────────────────
  const { apiKeyModalOpen, setApiKeyModalOpen, removingKey, removeApiKey } =
    useApiKeyManager({ authHeader, refresh, onError: setError });

  // ── Orb colorway picker ──────────────────────────────────────
  const { orbPickerOpen, setOrbPickerOpen, settingOrb, chooseOrbColorway } =
    useOrbColorway({
      current: overview?.queue.orbColorway ?? "creative-1",
      authHeader,
      refresh,
      onError: setError,
    });

  // Reset playback on session change (becomes the playback hook's resetPlayback
  // once that's extracted; the <audio> decks are cleared by the currentId effect).
  const resetPlayback = useCallback(() => {
    setCurrentId(null);
    setIsPlaying(false);
  }, []);

  const { creatingSession, createSession } = useSessionActions({
    authHeader,
    refresh,
    onError: setError,
    resetFilesView,
    resetPlayback,
  });

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

  // Play a specific queue row: select it, then drive the connected stage or the
  // local deck. (The drag-to-reorder state lives inside <HostQueuePanel>.)
  const onPlayItem = useCallback(
    (id: string) => {
      setCurrentId(id);
      if (stageConnected) sendCmd("select", id);
      else setIsPlaying(true);
    },
    [stageConnected, sendCmd]
  );

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


  // ── Console ──────────────────────────────────────────────────
  const counts = overview?.queue.counts;
  const requestsOpen = overview?.queue.requestsOpen ?? true;

  const autoDj = overview?.queue.autoDj ?? true;

  const stationIdPersonalize =
    overview?.activeSession?.stationIdPersonalize ?? false;
  const stationIdHostName = overview?.activeSession?.stationIdHostName ?? "";

  const orbColorway = overview?.queue.orbColorway ?? "creative-1";
  const currentColorway = resolveColorway(orbColorway);

  // Host session settings (toggles + Station-ID name + master volume).
  // Consumed by <HostControlsPanel> as a grouped object.
  const settings = useHostSettings({
    requestsOpen,
    autoDj,
    stationIdEnabled,
    crossfadeEnabled,
    stationIdPersonalize,
    stationIdHostName,
    serverMasterVolume: overview?.queue.masterVolume ?? 1,
    authHeader,
    refresh,
    onError: setError,
  });

  // ── ElevenLabs API key ───────────────────────────────────────
  // Non-admin hosts must connect their own key before they can use the console.
  // Admins fall back to the shared app key, so they're never gated.
  const apiKey = overview?.apiKey;
  const needsKeySetup = Boolean(overview) && !user.isAdmin && !apiKey?.hasKey;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-5 pb-16 pt-2 sm:px-8">
      {/* Header / status bar — compact control strip */}
      <HostHeader
        user={user}
        sessionName={activeSession?.name}
        publicCode={activeSession?.publicCode}
        needsKeySetup={needsKeySetup}
        currentColorwaySrc={currentColorway.src}
        counts={counts}
        error={error}
        onOpenOrbPicker={() => setOrbPickerOpen(true)}
        onOpenSessions={() => setSessionsModalOpen(true)}
        onRefresh={refresh}
        onSignOut={signOut}
      />

      {/* Working area — multi-column to use the viewport */}
      <div className="mt-4 grid gap-4 lg:grid-cols-12 lg:items-start">
        {/* Left column — controls + transport */}
        <div className="space-y-4 lg:col-span-4">
          {/* DJ booth — host spins a track straight into the queue */}
          <DjBooth
            prompt={hostPrompt}
            onPromptChange={setHostPrompt}
            remaining={hostRemaining}
            trimmed={hostTrimmed}
            name={hostName}
            onNameChange={setHostName}
            instrumental={hostInstrumental}
            onToggleInstrumental={() => setHostInstrumental((value) => !value)}
            ideasOpen={hostIdeasOpen}
            onToggleIdeas={() => setHostIdeasOpen((open) => !open)}
            submitting={hostSubmitting}
            canSubmit={canHostSubmit}
            onSubmit={submitHostPrompt}
            job={hostJob}
            jobFailed={hostJobFailed}
            jobDone={hostJobDone}
            jobStep={hostJobStep}
            jobMessage={hostJobMessage}
          />

          {/* Controls — request line, AutoDJ, Station ID, crossfade, volume,
              public link, API key */}
          <HostControlsPanel
            requestsOpen={requestsOpen}
            autoDj={autoDj}
            stationIdEnabled={stationIdEnabled}
            crossfadeEnabled={crossfadeEnabled}
            stationIdPersonalize={stationIdPersonalize}
            stationIdHostName={stationIdHostName}
            settings={settings}
            sessionLink={sessionLink}
            apiKey={apiKey}
            removeApiKey={removeApiKey}
            removingKey={removingKey}
            onAddKey={() => setApiKeyModalOpen(true)}
            isAdmin={user.isAdmin}
          />
        </div>

        {/* Middle column — pending approvals + live queue */}
        <div className="space-y-4 lg:col-span-5">
          {/* Player — compact transport */}
          <HostPlayerCard
            stageConnected={stageConnected}
            isPlaying={isPlaying}
            current={current}
            readyCount={readyItems.length}
            onPlay={playCurrent}
            onPause={pauseCurrent}
            onSkip={() => advance(false)}
          />

          {/* Two hidden decks — local audio output with the same crossfade
              engine as the stage. Kept inline (not in HostPlayerCard) because
              their onPlay/onPause/onEnded bind to timing-critical playback refs.
              Always mounted so the WebAudio graph exists; they only play when no
              stage is connected. */}
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

          {/* Pending approval (shown in approval mode or whenever anything waits).
              The wrapper is always rendered so the onboarding tour has a stable
              anchor even when the panel itself is hidden. */}
          <PendingApprovalsPanel
            pendingItems={pendingItems}
            autoDj={autoDj}
            bulkBusy={bulkBusy}
            busyId={busyId}
            onApprove={(id) => runAction(id, "approve")}
            onReject={(id) => runAction(id, "reject")}
            onApproveAll={(ids) => runBulk("approve", ids)}
          />

          {/* Queue */}
          <HostQueuePanel
            readyItems={readyItems}
            displayItems={displayItems}
            current={current}
            activeStationId={activeStationId}
            isPlaying={isPlaying}
            reordering={reordering}
            queueSel={queueSel}
            setQueueSel={setQueueSel}
            toggle={toggle}
            bulkBusy={bulkBusy}
            busyId={busyId}
            runBulk={runBulk}
            runAction={runAction}
            onReorder={reorder}
            onPlayItem={onPlayItem}
            onPlayStationId={playStationId}
            onOpenDetail={setDetailItem}
          />
        </div>

        {/* Right column — file library */}
        <HostFilesPanel
          files={files}
          filesLoading={filesLoading}
          filesSessionId={filesSessionId}
          onPickSession={onPickSession}
          activeSession={activeSession}
          sessions={sessions}
          filesSel={filesSel}
          setFilesSel={setFilesSel}
          toggle={toggle}
          downloadSelected={downloadSelected}
          downloadFile={downloadFile}
          refreshFilesView={refreshFilesView}
          bulkBusy={bulkBusy}
          busyId={busyId}
          runBulk={runBulk}
          runAction={runAction}
          deleteRow={deleteRow}
        />
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
      <OrbColorwayPicker
        open={orbPickerOpen}
        current={orbColorway}
        settingName={settingOrb}
        onClose={() => setOrbPickerOpen(false)}
        onChoose={chooseOrbColorway}
      />
    </main>
  );
}
