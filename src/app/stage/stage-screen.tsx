"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Image from "next/image";
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { QRCodeSVG } from "qrcode.react";

import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import { useStageAudio } from "@/lib/use-stage-audio";
import { ReactiveOrb } from "@/components/orb/ReactiveOrb";
import { resolveColorway } from "@/components/orb/colorways";
import { useColorwayPalette } from "@/components/orb/use-colorway-palette";
import { AudioProgressSlider } from "@/components/ui/audio-progress-slider";
import type { LyricWord, QueueItem, QueueSnapshot } from "@/lib/status";
import { asHostCommand, createStageChannel } from "@/lib/stage-sync";
import { STATION_ID_CADENCE } from "@/lib/station-id";

import styles from "./stage.module.css";

const TOKEN_KEY = "elevendj-admin-token";

// Render a lyric line as karaoke: words fill from dim to bright as playback
// passes each word's start. Punctuation-only tokens (no startMs) inherit the
// state of the word before them so commas don't flicker ahead of their word.
function renderKaraokeLine(words: LyricWord[], posMs: number) {
  let lastSung = false;
  return words.map((word, wi) => {
    if (typeof word.startMs === "number") lastSung = posMs >= word.startMs;
    return (
      <span
        key={wi}
        className={lastSung ? "text-white" : "text-white/30"}
        style={{ transition: "color 150ms linear" }}
      >
        {word.text}
        {wi < words.length - 1 ? " " : ""}
      </span>
    );
  });
}

// mm:ss for the progress readout.
function formatClock(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function StageScreen({ code }: { code: string | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  const { analyserRef, resume } = useStageAudio(audioRef);

  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [requestUrl, setRequestUrl] = useState("");
  // Local-only mute for this stage device — silences the speaker here without
  // touching the host's authoritative master volume (which other clients see).
  const [muted, setMuted] = useState(false);

  // Master volume is host-controlled (set from the console) and arrives in the
  // queue snapshot. The stage obeys it — the slider below is a read-only mirror.
  const masterVolume = snapshot?.masterVolume ?? 1;

  // Drive the single audio element from the authoritative master + local mute.
  // The element keeps its volume across src changes, so this is the only place
  // that needs to set it.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = masterVolume;
      audio.muted = muted;
    }
  }, [masterVolume, muted]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
  }, []);

  // ── Data polling ─────────────────────────────────────────────
  const refreshQueue = useCallback(async () => {
    if (!code) {
      return;
    }
    try {
      const response = await fetch(
        `/api/queue?code=${encodeURIComponent(code)}`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        return;
      }
      setSnapshot((await response.json()) as QueueSnapshot);
    } catch {
      /* keep last good snapshot; the orb idles gracefully */
    }
  }, [code]);

  useRealtimeRefresh(refreshQueue);

  useEffect(() => {
    refreshQueue();
    const interval = window.setInterval(refreshQueue, 5000);
    return () => window.clearInterval(interval);
  }, [refreshQueue]);

  useEffect(() => {
    setRequestUrl(`${window.location.origin}/request`);
  }, []);

  const readyItems = useMemo(
    () =>
      (snapshot?.items ?? []).filter(
        (item: QueueItem) => item.status === "ready" && item.audioUrl
      ),
    [snapshot]
  );

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

  // ── Station ID injection ─────────────────────────────────────
  // When enabled, after every STATION_ID_CADENCE real songs the stage drops in
  // a pre-generated ~10s radio ID from the warm pool, then advances normally.
  const stationIdEnabled = snapshot?.stationIdEnabled ?? false;
  const stationIds = useMemo(() => snapshot?.stationIds ?? [], [snapshot]);
  const [activeStationId, setActiveStationId] = useState<QueueItem | null>(null);
  // "Armed" means play an ID at the next opportunity regardless of cadence —
  // set when the host flips the feature on, so the first ID doesn't wait for
  // two songs. Cleared once it fires.
  const [stationArmed, setStationArmed] = useState(false);
  const prevStationEnabledRef = useRef<boolean | null>(null);
  // Refs (not state): the counter/cursor must not retrigger renders, and the
  // ended handler reads them synchronously.
  const playsSinceIdRef = useRef(0);
  const stationCursorRef = useRef(0);

  // What's actually coming out of the speaker: a station ID when one is in
  // flight, otherwise the real current track. Presentation (audio src, lyrics,
  // title, duration) follows this; queue/sync/advance logic stays on `current`.
  const nowPlaying = activeStationId ?? current;

  // Arm on the off→on transition the stage observes (host toggled it on), so an
  // ID plays at the next playable point instead of waiting out the cadence.
  // First load doesn't arm (prev starts null) — opening the stage on an
  // already-on session shouldn't replay an ID.
  useEffect(() => {
    const prev = prevStationEnabledRef.current;
    prevStationEnabledRef.current = stationIdEnabled;
    if (prev === false && stationIdEnabled) {
      setStationArmed(true);
      playsSinceIdRef.current = 0;
    } else if (prev && !stationIdEnabled) {
      setStationArmed(false);
    }
  }, [stationIdEnabled]);

  // Tell the host a station ID finished so it archives it and warms a fresh
  // replacement. Best-effort and token-gated, mirroring publishNowPlaying — if
  // the stage has no host token the pool simply reuses its existing variations.
  const consumeStationId = useCallback((id: string) => {
    const token =
      typeof window !== "undefined"
        ? window.localStorage.getItem(TOKEN_KEY)
        : null;
    if (!token) {
      return;
    }
    fetch("/api/admin/station-id", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id }),
    }).catch(() => {
      /* best-effort */
    });
  }, []);

  // Armed + nothing currently playing → drop an ID in at the top as soon as one
  // is warm. When a song IS playing we leave this alone and let the ended
  // handler inject right after it (the "next point it can play"). Re-runs when
  // the pool warms (stationIds changes), so it fires even if no ID was ready at
  // enable time.
  useEffect(() => {
    if (
      stationArmed &&
      stationIdEnabled &&
      !nowPlaying &&
      stationIds.length > 0
    ) {
      const pick = stationIds[stationCursorRef.current % stationIds.length];
      stationCursorRef.current += 1;
      setStationArmed(false);
      playsSinceIdRef.current = 0;
      setActiveStationId(pick);
      setIsPlaying(true);
    }
  }, [stationArmed, stationIdEnabled, nowPlaying, stationIds]);

  // ── Now-playing publish (optional, only if a token is present) ─
  const publishNowPlaying = useCallback(
    (requestId: string | null, playing: boolean) => {
      const token =
        typeof window !== "undefined"
          ? window.localStorage.getItem(TOKEN_KEY)
          : null;
      if (!token) {
        return; // graceful no-op when the stage is opened without the host token
      }
      fetch("/api/admin/playback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ requestId, isPlaying: playing }),
      }).catch(() => {
        /* publishing is best-effort */
      });
    },
    []
  );

  // ── Player controls ──────────────────────────────────────────
  const playCurrent = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !nowPlaying?.audioUrl) {
      return;
    }
    if (audio.src !== nowPlaying.audioUrl) {
      audio.src = nowPlaying.audioUrl;
    }
    try {
      await audio.play();
      resume();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }, [nowPlaying, resume]);

  function pauseCurrent() {
    audioRef.current?.pause();
    setIsPlaying(false);
  }

  const advance = useCallback(() => {
    if (readyItems.length === 0) {
      return;
    }
    const index = readyItems.findIndex((item) => item.id === current?.id);
    const next = readyItems[index + 1] ?? readyItems[0];
    setIsPlaying(false);
    if (next && next.id !== current?.id) {
      setCurrentId(next.id);
      setIsPlaying(true);
    } else if (readyItems.length === 1) {
      // single track — restart it
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        void audio.play().then(() => setIsPlaying(true));
      }
    }
  }, [current, readyItems]);

  // Decide what happens when the audio element finishes a clip.
  const handleTrackEnded = useCallback(() => {
    // A station ID just finished: archive it + warm a fresh one, reset the
    // counter, and advance to the next real track.
    if (activeStationId) {
      const playedId = activeStationId.id;
      setActiveStationId(null);
      playsSinceIdRef.current = 0;
      consumeStationId(playedId);
      advance();
      return;
    }
    // A real song finished. Count it; when armed (host just enabled it) or the
    // cadence is reached and a warm ID is ready, drop it in instead of advancing
    // (the counter resets when the ID ends). No warm ID → just advance and retry
    // on the next song end.
    playsSinceIdRef.current += 1;
    const cadenceReached = playsSinceIdRef.current >= STATION_ID_CADENCE;
    if (
      stationIdEnabled &&
      stationIds.length > 0 &&
      (stationArmed || cadenceReached)
    ) {
      const pick = stationIds[stationCursorRef.current % stationIds.length];
      stationCursorRef.current += 1;
      if (stationArmed) {
        setStationArmed(false);
      }
      setIsPlaying(false);
      setActiveStationId(pick);
      setIsPlaying(true);
      return;
    }
    advance();
  }, [
    activeStationId,
    advance,
    consumeStationId,
    stationArmed,
    stationIdEnabled,
    stationIds,
  ]);

  // When what's playing changes while we intend to keep playing, (re)start it.
  // Keyed on nowPlaying so switching to/from a station ID triggers playback.
  useEffect(() => {
    if (isPlaying) {
      playCurrent().catch(() => setIsPlaying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlaying?.id]);

  // Publish whenever the playing track or play/pause state changes.
  useEffect(() => {
    publishNowPlaying(isPlaying ? current?.id ?? null : current?.id ?? null, isPlaying);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, current?.id]);

  // ── Host ⇄ stage sync (this tab is the single audio output) ──
  // Jump to a specific track and play it.
  const selectTrack = useCallback(
    (trackId: string | null) => {
      if (trackId && trackId !== currentId) {
        setCurrentId(trackId);
        setIsPlaying(true); // the [currentId] effect starts playback
      } else {
        void playCurrent();
      }
    },
    [currentId, playCurrent]
  );

  // Keep the latest handlers + state available to the (mount-only) channel.
  const actionsRef = useRef({ playCurrent, pauseCurrent, advance, selectTrack });
  const syncStateRef = useRef({ currentId: null as string | null, isPlaying });
  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    actionsRef.current = { playCurrent, pauseCurrent, advance, selectTrack };
    syncStateRef.current = { currentId: current?.id ?? null, isPlaying };
  });

  // Open the channel: obey host commands, announce presence + state.
  useEffect(() => {
    const ch = createStageChannel();
    channelRef.current = ch;
    if (!ch) {
      return;
    }
    const announce = (
      type: "hello" | "heartbeat" | "bye",
      playing = syncStateRef.current.isPlaying
    ) => {
      try {
        ch.postMessage({
          source: "stage",
          type,
          currentId: syncStateRef.current.currentId,
          isPlaying: playing,
        });
      } catch {
        /* channel closed */
      }
    };
    ch.onmessage = (event: MessageEvent) => {
      const cmd = asHostCommand(event.data);
      if (!cmd) {
        return;
      }
      const a = actionsRef.current;
      if (cmd.action === "play") void a.playCurrent();
      else if (cmd.action === "pause") a.pauseCurrent();
      else if (cmd.action === "next") a.advance();
      else if (cmd.action === "select") a.selectTrack(cmd.trackId ?? null);
    };
    announce("hello");
    const hb = window.setInterval(() => announce("heartbeat"), 3000);
    const announceBye = () => announce("bye", false);
    window.addEventListener("pagehide", announceBye);
    window.addEventListener("beforeunload", announceBye);
    return () => {
      announceBye();
      window.clearInterval(hb);
      window.removeEventListener("pagehide", announceBye);
      window.removeEventListener("beforeunload", announceBye);
      ch.close();
      channelRef.current = null;
    };
  }, []);

  // Broadcast state so the host mirrors what the stage is actually doing.
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch) {
      return;
    }
    try {
      ch.postMessage({
        source: "stage",
        type: "state",
        currentId: current?.id ?? null,
        isPlaying,
      });
    } catch {
      /* channel closed */
    }
  }, [isPlaying, current?.id]);

  // ── Fullscreen ───────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
    } else {
      document.exitFullscreen?.().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ── Keyboard remote (complements the auto-hiding control chip) ─
  // Space / K → play-pause, N / → → next, F → fullscreen. Space also serves as
  // the user-gesture that unlocks audio playback on the stage tab.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.getAttribute("role") === "slider")
      ) {
        return;
      }
      if (event.code === "Space" || event.key === "k") {
        event.preventDefault();
        if (isPlaying) pauseCurrent();
        else void playCurrent();
      } else if (event.key === "ArrowRight" || event.key === "n") {
        advance();
      } else if (event.key === "f") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPlaying, playCurrent, advance, toggleFullscreen]);

  // ── Auto-hiding controls ─────────────────────────────────────
  useEffect(() => {
    let timer: number | undefined;
    const reveal = () => {
      setControlsVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setControlsVisible(false), 2500);
    };
    reveal();
    window.addEventListener("mousemove", reveal);
    window.addEventListener("touchstart", reveal);
    window.addEventListener("keydown", reveal);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", reveal);
      window.removeEventListener("touchstart", reveal);
      window.removeEventListener("keydown", reveal);
    };
  }, []);

  // ── Lyrics (timed blocks synced to playback position) ────────
  const [posMs, setPosMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  // Prefer the live audio duration; fall back to the stored track length.
  const totalMs = durationMs || nowPlaying?.durationMs || 0;

  const seekToSeconds = useCallback(
    (seconds: number) => {
      if (totalMs <= 0) return;
      const nextMs = Math.min(totalMs, Math.max(0, seconds * 1000));
      const audio = audioRef.current;

      if (audio) {
        if (nowPlaying?.audioUrl && audio.src !== nowPlaying.audioUrl) {
          audio.src = nowPlaying.audioUrl;
        }
        audio.currentTime = nextMs / 1000;
      }
      setPosMs(nextMs);
    },
    [nowPlaying?.audioUrl, totalMs]
  );

  // Upcoming tracks in play order (wraps, excludes the current track).
  const upcoming = useMemo(() => {
    if (readyItems.length === 0) return [];
    const startIndex = current
      ? readyItems.findIndex((item) => item.id === current.id) + 1
      : 0;
    const span = current ? readyItems.length - 1 : readyItems.length;
    const out: QueueItem[] = [];
    for (let k = 0; k < span && out.length < 4; k++) {
      out.push(readyItems[(startIndex + k) % readyItems.length]);
    }
    return out;
  }, [readyItems, current]);

  // `onTimeUpdate` fires only ~4×/sec; drive posMs off rAF while playing so
  // per-word karaoke fill stays smooth. Idle/paused falls back to timeupdate.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) setPosMs(audio.currentTime * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // Flatten every lyric line into one timed list with an absolute startMs, so
  // the stage can run a continuous karaoke scroll instead of swapping whole
  // blocks. Prefers real per-line/word timestamps; falls back to spreading each
  // section's duration evenly across its lines.
  const lyricLines = useMemo(() => {
    const sections = nowPlaying?.lyrics?.sections;
    if (!sections || sections.length === 0) return null;

    const out: {
      key: string;
      words?: LyricWord[];
      text: string;
      startMs: number;
    }[] = [];

    let cumulative = 0;
    sections.forEach((section, si) => {
      const sectionStart =
        typeof section.startMs === "number" ? section.startMs : cumulative;
      const lineCount = section.lines.length || 1;
      const per = (section.durationMs || 0) / lineCount;

      section.lines.forEach((line, li) => {
        let startMs: number;
        if (typeof line.startMs === "number") {
          startMs = line.startMs;
        } else {
          const firstWord = line.words?.find(
            (w) => typeof w.startMs === "number"
          );
          startMs =
            typeof firstWord?.startMs === "number"
              ? firstWord.startMs
              : sectionStart + per * li;
        }
        out.push({ key: `${si}-${li}`, words: line.words, text: line.text, startMs });
      });

      cumulative = sectionStart + (section.durationMs || 0);
    });

    // Keep timestamps monotonic so the active-line scan can't jump backwards.
    for (let i = 1; i < out.length; i++) {
      if (out[i].startMs < out[i - 1].startMs) {
        out[i].startMs = out[i - 1].startMs;
      }
    }

    return out;
  }, [nowPlaying?.lyrics]);

  // Index of the line currently being sung (last line whose start has passed).
  const activeLineIndex = useMemo(() => {
    if (!lyricLines || lyricLines.length === 0) return 0;
    let idx = 0;
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].startMs <= posMs) idx = i;
    }
    return idx;
  }, [lyricLines, posMs]);

  // ── Karaoke scroll: slide the line stack so the active line sits in a fixed
  //    slot, keeping a couple of sung lines above and upcoming lines below. ──
  const lyricViewportRef = useRef<HTMLDivElement>(null);
  const lyricScrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);

  const positionLyrics = useCallback(() => {
    const viewport = lyricViewportRef.current;
    const scroll = lyricScrollRef.current;
    const active = lineRefs.current[activeLineIndex];
    if (!viewport || !scroll || !active) return;
    // Anchor the active line ~38% down the window.
    const target = viewport.clientHeight * 0.38 - active.offsetHeight / 2;
    scroll.style.transform = `translateY(${target - active.offsetTop}px)`;
  }, [activeLineIndex]);

  useLayoutEffect(() => {
    positionLyrics();
  }, [positionLyrics, lyricLines]);

  useEffect(() => {
    window.addEventListener("resize", positionLyrics);
    return () => window.removeEventListener("resize", positionLyrics);
  }, [positionLyrics]);

  const idle = !nowPlaying;

  // ── Orb colorway + background tint ───────────────────────────
  // The host's selected colorway drives both the orb texture and the stage
  // background: we sample the gradient's colors and expose them as CSS vars so
  // the neutral grey base recolors to match the orb.
  const colorway = resolveColorway(snapshot?.orbColorway);
  const palette = useColorwayPalette(colorway.src);
  const stageStyle = {
    "--orb-bg-primary": palette.primary,
    "--orb-bg-accent": palette.accent,
  } as CSSProperties;

  // No session code in the URL — render a friendly notice and fetch nothing.
  if (!code) {
    return (
      <div className={styles.stage} style={stageStyle}>
        {/* Background layers */}
        <div className={styles.bgBase} aria-hidden />
        <div className={styles.bgTint} aria-hidden />
        <div className={styles.bgGlow} aria-hidden />
        <div className={styles.bgVignette} aria-hidden />
        <div className={styles.bgGrain} aria-hidden />

        <div className={`${styles.heroStack} absolute inset-0 z-10`}>
          <div className="flex flex-col items-center gap-3 text-center">
            <p className={styles.eyebrow}>ElevenDJ</p>
            <h1 className={`${styles.title} ${styles.titleIdle}`}>
              No session linked
            </h1>
            <p className="mt-2 max-w-xl text-sm text-white/55 sm:text-base">
              Open the stage from your host console so it knows which room to
              display.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${styles.stage} ${controlsVisible ? "" : styles.cursorHidden}`}
      style={stageStyle}
    >
      {/* Background layers — neutral grey base recolored to match the orb */}
      <div className={styles.bgBase} aria-hidden />
      <div className={styles.bgTint} aria-hidden />
      <div className={styles.bgGlow} aria-hidden />
      <div className={styles.bgVignette} aria-hidden />
      <div className={styles.bgGrain} aria-hidden />

      {/* Brand lockup — icon + DJ, inverted for hero background */}
      <div className={`${styles.brandLockup} absolute left-6 top-6 z-20 sm:left-9 sm:top-8`}>
        <Image
          src="/brand/icon-white.svg"
          alt="ElevenLabs"
          width={101}
          height={160}
          priority
          unoptimized
          className={styles.brandLogo}
        />
        <span className="brand-dj brand-dj--hero" aria-hidden>
          DJ
        </span>
      </div>

      {/* QR corner — scan to reach the public request page (only while requests are open) */}
      {requestUrl && snapshot?.requestsOpen && (
        <div className="absolute bottom-6 right-6 z-20 flex flex-col items-center gap-2 rounded-2xl bg-white/95 p-3 shadow-2xl sm:bottom-9 sm:right-9">
          <QRCodeSVG value={requestUrl} size={108} bgColor="#ffffff" fgColor="#1E1916" level="M" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#1E1916]">
            Scan to request
          </span>
        </div>
      )}

      {/* Centerpiece — orb sits in the upper area; wordmark lives in the bg image */}
      <div className={`${styles.heroStack} absolute inset-0 z-10`}>
        <div className={styles.orbWrap}>
          <ReactiveOrb
            analyserRef={analyserRef}
            texture={colorway.src}
            saturation={colorway.saturation}
            className={styles.orbGl}
          />
        </div>

        {/* Track title + attribution — sits below the orb, above the progress
            bar, while lyrics scroll lower in the hero. */}
        {nowPlaying && lyricLines && (
          <div className="flex flex-col items-center gap-1">
            <p className="max-w-xl truncate text-base text-white/70 sm:text-lg">
              {nowPlaying.title || nowPlaying.prompt}
            </p>
            <p className="text-xs uppercase tracking-[0.18em] text-white/40">
              {activeStationId
                ? "Station ID · ElevenDJ Radio"
                : `Requested by ${nowPlaying.requesterName || "Anonymous"}`}
            </p>
          </div>
        )}

        {/* Subtle song progress beneath the orb */}
        {!idle && totalMs > 0 && (
          <div className={styles.progress}>
            <AudioProgressSlider
              aria-label="Song progress"
              value={posMs / 1000}
              duration={totalMs / 1000}
              onSeek={seekToSeconds}
              className={styles.progressSlider}
              trackClassName={styles.progressTrack}
              rangeClassName={styles.progressFill}
              thumbClassName={styles.progressThumb}
            />
            <div className={styles.progressMeta}>
              <span>{formatClock(posMs)}</span>
              <span>{formatClock(totalMs)}</span>
            </div>
          </div>
        )}

        <div className="flex flex-col items-center gap-3">
          {idle ? (
            <>
              <p className={styles.eyebrow}>ElevenDJ</p>
              <h1 className={`${styles.title} ${styles.titleIdle}`}>
                Waiting for the next track&hellip;
              </h1>
              {requestUrl && snapshot?.requestsOpen && (
                <p className="mt-2 flex flex-col items-center gap-2">
                  <span className={styles.eyebrow}>Request a track</span>
                  <span className={styles.requestUrl}>{requestUrl}</span>
                </p>
              )}
            </>
          ) : lyricLines ? (
            <div className="flex w-full max-w-4xl flex-col items-center gap-5">
              {/* Lyrics — a fixed-height karaoke window. Lines stay large; the
                  stack slides up as the song advances so only a few lines show
                  at once and long verses never run off-screen. */}
              <div
                ref={lyricViewportRef}
                className="relative w-full overflow-hidden px-4"
                style={{
                  height: "clamp(8.5rem, 40vh, 22rem)",
                  maskImage:
                    "linear-gradient(to bottom, transparent 0%, #000 20%, #000 72%, transparent 100%)",
                  WebkitMaskImage:
                    "linear-gradient(to bottom, transparent 0%, #000 20%, #000 72%, transparent 100%)",
                }}
              >
                <div
                  ref={lyricScrollRef}
                  className="relative flex flex-col items-center gap-[0.45em] text-center will-change-transform"
                  style={{
                    fontFamily: "var(--font-brand)",
                    fontWeight: 300,
                    fontSize: "clamp(1.6rem, 4vw, 3.25rem)",
                    lineHeight: 1.18,
                    transition:
                      "transform 600ms cubic-bezier(0.22, 0.61, 0.36, 1)",
                  }}
                >
                  {lyricLines.map((line, i) => {
                    const isActive = i === activeLineIndex;
                    return (
                      <p
                        key={line.key}
                        ref={(el) => {
                          lineRefs.current[i] = el;
                        }}
                        className={`text-balance transition-[color,opacity] duration-500 ${
                          isActive
                            ? ""
                            : i < activeLineIndex
                              ? "text-white/35"
                              : "text-white/25"
                        }`}
                      >
                        {isActive && line.words?.length
                          ? renderKaraokeLine(line.words, posMs)
                          : line.text}
                      </p>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <>
              <p className={styles.eyebrow}>
                {activeStationId ? "Station ID" : "Now playing"}
              </p>
              <h1 className={styles.title}>
                {nowPlaying.title || nowPlaying.prompt}
              </h1>
              {!activeStationId && nowPlaying.title ? (
                <p className="max-w-xl truncate text-sm text-white/55 sm:text-base">
                  {nowPlaying.prompt}
                </p>
              ) : null}
              {activeStationId ? (
                <p className={styles.requester}>ElevenDJ Radio</p>
              ) : nowPlaying.requesterName ? (
                <p className={styles.requester}>
                  Requested by {nowPlaying.requesterName}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Hidden audio source — this tab is the audio output for the screenshare. */}
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        className="hidden"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleTrackEnded}
        onLoadedMetadata={(event) => {
          setPosMs(0);
          const d = event.currentTarget.duration;
          setDurationMs(Number.isFinite(d) ? d * 1000 : 0);
        }}
        onDurationChange={(event) => {
          const d = event.currentTarget.duration;
          setDurationMs(Number.isFinite(d) ? d * 1000 : 0);
        }}
        onTimeUpdate={(event) =>
          setPosMs(event.currentTarget.currentTime * 1000)
        }
      >
        <track kind="captions" />
      </audio>

      {/* Auto-hiding control chip — appears on mouse/touch/key, fades when idle */}
      <div
        className={`${styles.controls} ${
          controlsVisible ? "" : styles.hidden
        } absolute bottom-8 left-1/2 z-30 -translate-x-1/2`}
      >
        <button
          type="button"
          onClick={isPlaying ? pauseCurrent : playCurrent}
          disabled={!current?.audioUrl}
          className={`${styles.ctrlBtn} ${styles.ctrlPrimary}`}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button
          type="button"
          onClick={advance}
          disabled={readyItems.length < 2}
          className={styles.ctrlBtn}
          aria-label="Next track"
        >
          <SkipForward size={20} />
        </button>

        {/* Volume — button is a local mute; the slider mirrors the host's
            master volume (set from the console) and is read-only here. */}
        <div className={styles.volume}>
          <button
            type="button"
            onClick={toggleMute}
            className={styles.ctrlBtn}
            aria-label={muted || masterVolume === 0 ? "Unmute" : "Mute"}
          >
            {muted || masterVolume === 0 ? (
              <VolumeX size={20} />
            ) : masterVolume < 0.5 ? (
              <Volume1 size={20} />
            ) : (
              <Volume2 size={20} />
            )}
          </button>
          <div className={styles.volumePanel}>
            <SliderPrimitive.Root
              className={styles.volumeSlider}
              value={[muted ? 0 : masterVolume]}
              min={0}
              max={1}
              step={0.01}
              disabled
              aria-label="Master volume (set on the host console)"
            >
              <SliderPrimitive.Track className={styles.progressTrack}>
                <SliderPrimitive.Range className={styles.progressFill} />
              </SliderPrimitive.Track>
              <SliderPrimitive.Thumb className={styles.progressThumb} />
            </SliderPrimitive.Root>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleFullscreen}
          className={styles.ctrlBtn}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
        </button>
      </div>

      {/* Up Next — stylized upcoming queue (bottom-left) */}
      {upcoming.length > 0 && (
        <div className={`${styles.queue} absolute right-6 top-6 z-20 sm:right-9 sm:top-9`}>
          <div className={styles.queueHeader}>
            <span className={styles.queuePulse} aria-hidden />
            Up Next
            <span className={styles.queueCount}>{upcoming.length}</span>
          </div>
          <ul className={styles.queueList}>
            {upcoming.map((item, i) => (
              <li key={item.id} className={styles.queueItem}>
                <span className={styles.queueIndex}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className={styles.queueText}>
                  <span className={styles.queueTitle}>
                    {item.title || item.prompt}
                  </span>
                  <span className={styles.queueBy}>
                    {item.requesterName || "Anonymous"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
