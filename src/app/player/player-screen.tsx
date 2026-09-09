"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pause, Play, Volume2 } from "lucide-react";

import { ReactiveOrb } from "@/components/orb/ReactiveOrb";
import { resolveColorway } from "@/components/orb/colorways";
import { useStageAudio } from "@/lib/use-stage-audio";
import type { QueueItem } from "@/lib/status";
import {
  computePlayingPositionMs,
  shouldSeekForDrift,
  useRemotePlayback,
  type PlayerStateResponse,
} from "./use-remote-playback";
import { PlayerPairingScreen } from "./player-pairing-screen";

export function PlayerScreen() {
  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);
  const { analyserRef, resume, setDeckGain } = useStageAudio(
    audioARef,
    audioBRef
  );

  const [paired, setPaired] = useState<boolean | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [state, setState] = useState<PlayerStateResponse | null>(null);
  const [localPlaying, setLocalPlaying] = useState(false);
  const lastRevisionRef = useRef<number>(-1);
  const currentTrackRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/player/state", { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 401) {
          setPaired(false);
          return;
        }
        if (res.ok) {
          setPaired(true);
          const body = (await res.json()) as PlayerStateResponse;
          setState(body);
          setAudioUnlocked(body.device.audioUnlocked);
        } else {
          setPaired(false);
        }
      } catch {
        if (!cancelled) setPaired(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onState = useCallback((next: PlayerStateResponse) => {
    setState(next);
  }, []);

  const { report, reportEnded, error } = useRemotePlayback({
    enabled: paired === true,
    audioUnlocked,
    onState,
  });

  useEffect(() => {
    if (error === "unpaired") setPaired(false);
  }, [error]);

  const readyItems = useMemo(
    () =>
      (state?.queue?.items ?? []).filter(
        (item): item is QueueItem =>
          item.kind !== "station_id" &&
          item.status === "ready" &&
          Boolean(item.audioUrl)
      ),
    [state?.queue?.items]
  );

  const desiredId = state?.playback?.currentRequestId ?? null;
  const current = useMemo(
    () => readyItems.find((item) => item.id === desiredId) ?? null,
    [readyItems, desiredId]
  );

  const colorway = resolveColorway(state?.session?.orbColorway ?? "creative-1");

  useEffect(() => {
    if (!audioUnlocked || !state?.playback) return;
    const playback = state.playback;
    const audio = audioARef.current;
    if (!audio) return;

    const revisionChanged = playback.revision !== lastRevisionRef.current;
    const trackChanged = playback.currentRequestId !== currentTrackRef.current;

    if (revisionChanged || trackChanged) {
      lastRevisionRef.current = playback.revision;
      currentTrackRef.current = playback.currentRequestId;

      if (!current?.audioUrl) {
        audio.pause();
        setLocalPlaying(false);
        return;
      }

      if (audio.src !== current.audioUrl) {
        audio.src = current.audioUrl;
      }

      const target = computePlayingPositionMs({
        basePositionMs: playback.positionMs,
        isPlaying: playback.isPlaying,
        playbackStartedAt: playback.playbackStartedAt,
      });
      const localMs = (audio.currentTime || 0) * 1000;
      if (trackChanged || shouldSeekForDrift(localMs, target)) {
        try {
          audio.currentTime = target / 1000;
        } catch {
          /* seek later when ready */
        }
      }

      setDeckGain("a", 1);
      setDeckGain("b", 0);
      audio.volume = state.session?.masterVolume ?? 1;

      if (playback.isPlaying) {
        void audio
          .play()
          .then(() => {
            resume();
            setLocalPlaying(true);
          })
          .catch(() => setLocalPlaying(false));
      } else {
        audio.pause();
        setLocalPlaying(false);
      }
    }
  }, [
    audioUnlocked,
    state?.playback,
    state?.session?.masterVolume,
    current,
    resume,
    setDeckGain,
  ]);

  useEffect(() => {
    if (!paired || !state?.playback) return;
    const audio = audioARef.current;
    const tick = () => {
      const positionMs = Math.floor((audio?.currentTime ?? 0) * 1000);
      void report({
        requestId: state.playback?.currentRequestId ?? null,
        revision: state.playback?.revision ?? 0,
        isPlaying: localPlaying,
        positionMs,
      });
    };
    const timer = window.setInterval(tick, 5000);
    tick();
    return () => window.clearInterval(timer);
  }, [paired, state?.playback, localPlaying, report]);

  useEffect(() => {
    const audio = audioARef.current;
    if (!audio) return;
    const onEnded = () => {
      const trackId = currentTrackRef.current;
      const revision = lastRevisionRef.current;
      if (trackId != null && revision >= 0) {
        void reportEnded(trackId, revision);
      }
    };
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [reportEnded]);

  const enableAudio = useCallback(async () => {
    const audio = audioARef.current;
    if (audio) {
      try {
        audio.muted = true;
        await audio.play();
        audio.pause();
        audio.muted = false;
        audio.currentTime = 0;
      } catch {
        /* still mark unlocked so subsequent remote plays can try */
      }
    }
    resume();
    setAudioUnlocked(true);
    void report({
      requestId: state?.playback?.currentRequestId ?? null,
      revision: state?.playback?.revision ?? 0,
      isPlaying: false,
      positionMs: 0,
    });
  }, [resume, report, state?.playback]);

  if (paired === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--cream)] text-sm text-[var(--mid-gray)]">
        Checking player…
      </div>
    );
  }

  if (!paired) {
    return (
      <PlayerPairingScreen
        onApproved={() => {
          setPaired(true);
        }}
      />
    );
  }

  const unassigned = !state?.session;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0c0a09] text-white">
      <audio ref={audioARef} preload="auto" playsInline />
      <audio ref={audioBRef} preload="auto" playsInline />

      <div className="absolute inset-0 flex items-center justify-center opacity-90">
        <div className="relative h-[min(70vw,520px)] w-[min(70vw,520px)]">
          <ReactiveOrb
            analyserRef={analyserRef}
            texture={colorway.src}
            saturation={colorway.saturation}
          />
        </div>
      </div>

      <div className="relative z-10 flex min-h-screen flex-col justify-between p-6 sm:p-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/55">
            {state?.device.name ?? "Player"}
            {state?.session?.roomName ? ` · ${state.session.roomName}` : ""}
          </p>
          <h1
            className="mt-2 max-w-3xl text-3xl sm:text-5xl"
            style={{ fontFamily: "var(--font-brand)" }}
          >
            {unassigned
              ? "Waiting for room assignment"
              : current?.title || current?.prompt || state?.session?.name}
          </h1>
          {current?.requesterName && (
            <p className="mt-2 text-sm text-white/60">
              Requested by {current.requesterName}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!audioUnlocked ? (
            <button
              type="button"
              onClick={() => void enableAudio()}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[var(--graphite)]"
            >
              <Volume2 size={16} />
              Enable audio
            </button>
          ) : (
            <span className="inline-flex h-12 items-center gap-2 rounded-full border border-white/20 px-5 text-sm text-white/80">
              {localPlaying ? <Pause size={16} /> : <Play size={16} />}
              {localPlaying ? "Playing" : "Paused"}
              <span className="text-white/40">
                · rev {state?.playback?.revision ?? 0}
              </span>
            </span>
          )}
          {unassigned && (
            <span className="text-sm text-white/55">
              An Offsite admin can assign this player to an agenda session.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
