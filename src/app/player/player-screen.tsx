"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
import { CancunPlayerScreen } from "./cancun-player-screen";

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
  const masterVolume = state?.session?.masterVolume ?? 1;

  // Volume is a room setting, not a playback revision. Keep both decks synced
  // independently so a Room DJ slider change affects the current track at once.
  useEffect(() => {
    if (audioARef.current) audioARef.current.volume = masterVolume;
    if (audioBRef.current) audioBRef.current.volume = masterVolume;
  }, [masterVolume]);

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
    current,
    resume,
    setDeckGain,
  ]);

  // Depends on the playback primitives, not the object: `state.playback` is a
  // fresh object on every 1s poll, and resubscribing on it restarted the
  // interval before it could fire, turning this into a 1Hz heartbeat.
  const reportedRequestId = state?.playback?.currentRequestId ?? null;
  const reportedRevision = state?.playback?.revision ?? null;

  useEffect(() => {
    if (!paired || reportedRevision === null) return;
    const tick = () => {
      const audio = audioARef.current;
      void report({
        requestId: reportedRequestId,
        revision: reportedRevision,
        isPlaying: localPlaying,
        positionMs: Math.floor((audio?.currentTime ?? 0) * 1000),
      });
    };
    const timer = window.setInterval(tick, 5000);
    tick();
    return () => window.clearInterval(timer);
  }, [paired, reportedRequestId, reportedRevision, localPlaying, report]);

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

  const unlockAudioUrl = current?.audioUrl ?? null;
  const unlockPlayback = state?.playback ?? null;
  const unlockMasterVolume = masterVolume;

  const enableAudio = useCallback(async () => {
    const audio = audioARef.current;
    const playback = unlockPlayback;

    // The user gesture is what browsers require to resume Web Audio. Load and
    // start the current track inside that same gesture too; awaiting play() on
    // an empty <audio> element can remain pending forever, which previously
    // meant we never reached setAudioUnlocked(true) and the orb stayed idle.
    resume();
    setAudioUnlocked(true);

    if (audio && unlockAudioUrl) {
      try {
        if (audio.src !== unlockAudioUrl) {
          audio.src = unlockAudioUrl;
        }
        audio.volume = unlockMasterVolume;
        setDeckGain("a", 1);
        setDeckGain("b", 0);

        const target = playback
          ? computePlayingPositionMs({
              basePositionMs: playback.positionMs,
              isPlaying: playback.isPlaying,
              playbackStartedAt: playback.playbackStartedAt,
            })
          : 0;
        audio.currentTime = target / 1000;

        if (playback?.isPlaying) {
          await audio.play();
          setLocalPlaying(true);
        }
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "NotAllowedError"
        ) {
          setAudioUnlocked(false);
          void report({
            requestId: playback?.currentRequestId ?? null,
            revision: playback?.revision ?? 0,
            isPlaying: false,
            positionMs: 0,
            audioUnlocked: false,
          });
          return;
        }
        // Keep the room unlocked for media-readiness errors; normal
        // reconciliation retries once metadata is available.
      }
    }

    void report({
      requestId: playback?.currentRequestId ?? null,
      revision: playback?.revision ?? 0,
      isPlaying: playback?.isPlaying ?? false,
      positionMs: Math.floor((audio?.currentTime ?? 0) * 1000),
      audioUnlocked: true,
    });
  }, [
    report,
    resume,
    setDeckGain,
    unlockAudioUrl,
    unlockMasterVolume,
    unlockPlayback,
  ]);

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

  return (
    <>
      <audio ref={audioARef} preload="auto" playsInline />
      <audio ref={audioBRef} preload="auto" playsInline />
      <CancunPlayerScreen
        analyserRef={analyserRef}
        texture={colorway.src}
        saturation={colorway.saturation}
        deviceName={state?.device.name ?? "Player"}
        session={state?.session ?? null}
        current={current}
        audioUnlocked={audioUnlocked}
        localPlaying={localPlaying}
        revision={state?.playback?.revision ?? 0}
        onEnableAudio={() => void enableAudio()}
      />
    </>
  );
}
