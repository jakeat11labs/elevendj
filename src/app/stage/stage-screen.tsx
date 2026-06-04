"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Maximize, Minimize, Pause, Play, SkipForward } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import { useStageAudio } from "@/lib/use-stage-audio";
import { ReactiveOrb } from "@/components/orb/ReactiveOrb";
import type { QueueItem, QueueSnapshot } from "@/lib/status";
import { asHostCommand, createStageChannel } from "@/lib/stage-sync";

import styles from "./stage.module.css";

const TOKEN_KEY = "elevendj-admin-token";

export function StageScreen() {
  const audioRef = useRef<HTMLAudioElement>(null);

  const { analyserRef, resume } = useStageAudio(audioRef);

  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [requestUrl, setRequestUrl] = useState("");

  // ── Data polling ─────────────────────────────────────────────
  const refreshQueue = useCallback(async () => {
    try {
      const response = await fetch("/api/queue", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      setSnapshot((await response.json()) as QueueSnapshot);
    } catch {
      /* keep last good snapshot; the orb idles gracefully */
    }
  }, []);

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
    if (!audio || !current?.audioUrl) {
      return;
    }
    if (audio.src !== current.audioUrl) {
      audio.src = current.audioUrl;
    }
    try {
      await audio.play();
      resume();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }, [current]);

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

  // When the selected track changes while we intend to keep playing.
  useEffect(() => {
    if (isPlaying) {
      playCurrent().catch(() => setIsPlaying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

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
    const announce = (type: "hello" | "heartbeat" | "bye") => {
      try {
        ch.postMessage({
          source: "stage",
          type,
          currentId: syncStateRef.current.currentId,
          isPlaying: syncStateRef.current.isPlaying,
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
    return () => {
      announce("bye");
      window.clearInterval(hb);
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

  const lyricView = useMemo(() => {
    const sections = current?.lyrics?.sections;
    if (!sections || sections.length === 0) return null;
    // Pick the section currently being sung by cumulative section duration.
    let acc = 0;
    let chosen = 0;
    for (let i = 0; i < sections.length; i++) {
      const dur = sections[i].durationMs || 0;
      if (posMs < acc + dur || i === sections.length - 1) {
        chosen = i;
        break;
      }
      acc += dur;
    }
    return { section: sections[chosen], index: chosen, total: sections.length };
  }, [current?.lyrics, posMs]);

  const idle = !current;

  return (
    <div
      className={`${styles.stage} ${controlsVisible ? "" : styles.cursorHidden}`}
    >
      {/* Background layers */}
      <div className={styles.bgGradient} aria-hidden />
      <div className={styles.bgVignette} aria-hidden />
      <div className={styles.bgGrain} aria-hidden />

      {/* Brand lockup — matches site header, inverted for hero background */}
      <div className={`${styles.brandLockup} absolute left-6 top-6 z-20 sm:left-9 sm:top-8`}>
        <Image
          src="/brand/logo-white.png"
          alt="ElevenLabs"
          width={150}
          height={26}
          priority
          className={styles.brandLogo}
        />
        <span className="brand-dj brand-dj--hero" aria-hidden>
          DJ
        </span>
      </div>

      {/* QR corner — scan to reach the public request page */}
      {requestUrl && (
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
          <ReactiveOrb analyserRef={analyserRef} className={styles.orbGl} />
        </div>

        <div className="flex flex-col items-center gap-3">
          {idle ? (
            <>
              <p className={styles.eyebrow}>ElevenDJ</p>
              <h1 className={`${styles.title} ${styles.titleIdle}`}>
                Waiting for the next track&hellip;
              </h1>
              {requestUrl && (
                <p className="mt-2 flex flex-col items-center gap-2">
                  <span className={styles.eyebrow}>Request a track</span>
                  <span className={styles.requestUrl}>{requestUrl}</span>
                </p>
              )}
            </>
          ) : lyricView ? (
            <div className="flex flex-col items-center gap-6">
              {/* Lyrics — the whole active block lights up, rotating by section */}
              <div
                key={lyricView.index}
                className="rise flex max-w-4xl flex-col items-center gap-2.5 px-4 text-center"
              >
                {lyricView.section.lines.map((line, i) => (
                  <p
                    key={i}
                    className="text-balance text-2xl leading-tight text-white sm:text-4xl"
                    style={{ fontFamily: "var(--font-brand)", fontWeight: 300 }}
                  >
                    {line.text}
                  </p>
                ))}
              </div>
              {/* Shrunk title + attribution beneath the lyrics */}
              <div className="flex flex-col items-center gap-1">
                <p className="max-w-xl truncate text-sm text-white/55 sm:text-base">
                  {current.prompt}
                </p>
                <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                  Requested by {current.requesterName || "Anonymous"}
                </p>
              </div>
            </div>
          ) : (
            <>
              <p className={styles.eyebrow}>Now playing</p>
              <h1 className={styles.title}>{current.prompt}</h1>
              {current.requesterName ? (
                <p className={styles.requester}>
                  Requested by {current.requesterName}
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
        onEnded={advance}
        onLoadedMetadata={() => setPosMs(0)}
        onTimeUpdate={(event) =>
          setPosMs(event.currentTarget.currentTime * 1000)
        }
      >
        <track kind="captions" />
      </audio>

      {/* Auto-hiding controls */}
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
        <button
          type="button"
          onClick={toggleFullscreen}
          className={styles.ctrlBtn}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
        </button>
      </div>
    </div>
  );
}
