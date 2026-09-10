"use client";

import {
  useCallback,
  useEffect,
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
import { useStageAudio, type Deck } from "@/lib/use-stage-audio";
import { ReactiveOrb } from "@/components/orb/ReactiveOrb";
import { resolveColorway } from "@/components/orb/colorways";
import { useColorwayPalette } from "@/components/orb/use-colorway-palette";
import { AudioProgressSlider } from "@/components/ui/audio-progress-slider";
import { useLyricsLines } from "@/lib/use-lyrics";
import type { QueueItem, QueueSnapshot } from "@/lib/status";
import { asHostCommand, createStageChannel } from "@/lib/stage-sync";

import { KaraokeViewport } from "./karaoke-viewport";
import styles from "./stage.module.css";

// How long a radio-style crossfade lasts. Clamped per-track to never exceed a
// fraction of a short clip (so 10s jingles still blend without overlapping their
// whole length).
const CROSSFADE_SEC = 3;

// mm:ss for the progress readout.
function formatClock(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function StageScreen({ code }: { code: string | null }) {
  // Two decks so tracks can crossfade (radio-style). Deck A is the default
  // active deck; B is the spare the next track fades in on.
  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);

  const { analyserRef, resume, setDeckGain, crossfade } = useStageAudio(
    audioARef,
    audioBRef
  );

  // Which deck currently owns "now playing" (drives lyrics/position/seek). A ref
  // mirror lets event handlers read it synchronously.
  const [activeDeck, setActiveDeck] = useState<Deck>("a");
  const activeDeckRef = useRef<Deck>("a");
  useEffect(() => {
    activeDeckRef.current = activeDeck;
  }, [activeDeck]);
  const deckEl = useCallback(
    (d: Deck) => (d === "a" ? audioARef.current : audioBRef.current),
    []
  );
  const activeEl = useCallback(
    () => deckEl(activeDeckRef.current),
    [deckEl]
  );
  // A crossfade is mid-flight: suppresses the play effect (the incoming deck is
  // already playing) and re-entrant crossfade triggers.
  const crossfadingRef = useRef(false);

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
  const crossfadeEnabled = snapshot?.crossfadeEnabled ?? false;

  // Drive BOTH decks' element volume from the authoritative master + local mute
  // (crossfade gain is separate, in WebAudio). Elements keep volume across src
  // changes, so this is the only place that sets it.
  useEffect(() => {
    for (const audio of [audioARef.current, audioBRef.current]) {
      if (audio) {
        audio.volume = masterVolume;
        audio.muted = muted;
      }
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
    if (!code) {
      setRequestUrl("");
      return;
    }
    setRequestUrl(
      `${window.location.origin}/request?code=${encodeURIComponent(code)}`
    );
  }, [code]);

  // The interleaved queue from the server — real songs with station-ID jingles
  // dropped in at their computed slots. This is the single source of truth for
  // playback order; the stage walks it instead of counting cadence itself.
  const placedItems = useMemo(
    () => snapshot?.items ?? [],
    [snapshot]
  );

  // Real, playable songs only — the backbone the `current` pointer tracks.
  // Station IDs are handled separately (held in `activeStationId`) so a refetch
  // can never yank the jingle that's mid-play out from under the player.
  const readyItems = useMemo(
    () =>
      placedItems.filter(
        (item: QueueItem) =>
          item.kind !== "station_id" &&
          item.status === "ready" &&
          item.audioUrl
      ),
    [placedItems]
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
  // Station IDs are no longer scheduled by a local cadence counter: the server
  // interleaves them into `placedItems` (see placeStationIds), and the stage
  // simply plays the jingle that sits next in that order. `activeStationId` is
  // the one currently in flight — held in state (not read from the queue) so a
  // refetch can't drop it mid-play.
  const stationIdEnabled = snapshot?.stationIdEnabled ?? false;
  const [activeStationId, setActiveStationId] = useState<QueueItem | null>(null);
  // The real song we paused on to play a jingle, so we resume in the right
  // place when it ends. null while a "lead" jingle (the stopped-start one) plays
  // — that resumes by playing the current top track rather than advancing past
  // it.
  const stationReturnRef = useRef<string | null>(null);
  // "Armed" = open the next stopped-start with a lead jingle. Set only when the
  // host toggles station IDs ON while nothing is playing (the note's "if we are
  // stopped, add the top one"), and consumed by the next play. Crucially NOT set
  // on pause/resume, so resuming a track never injects a stray jingle.
  const [stationArmed, setStationArmed] = useState(false);
  const prevStationEnabledRef = useRef<boolean | null>(null);
  const isPlayingRef = useRef(false);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // What's actually coming out of the speaker: a station ID when one is in
  // flight, otherwise the real current track. Presentation (audio src, lyrics,
  // title, duration) follows this; queue/sync/advance logic stays on `current`.
  const nowPlaying = activeStationId ?? current;

  // The jingle that should play immediately before `current` (the stopped-start
  // "lead") — the station_id sitting just ahead of the current track in the
  // interleaved order, or at the very top when nothing is current yet.
  const leadStationId = useCallback((): QueueItem | null => {
    if (!current) {
      const head = placedItems[0];
      return head?.kind === "station_id" ? head : null;
    }
    const idx = placedItems.findIndex((item) => item.id === current.id);
    const before = idx > 0 ? placedItems[idx - 1] : null;
    return before?.kind === "station_id" ? before : null;
  }, [current, placedItems]);

  // The jingle that should play right after `songId` finishes, per the server's
  // interleaving — or null if a real song comes next.
  const stationIdAfter = useCallback(
    (songId: string | null | undefined): QueueItem | null => {
      if (!songId) {
        return null;
      }
      const idx = placedItems.findIndex((item) => item.id === songId);
      const next = idx >= 0 ? placedItems[idx + 1] : null;
      return next?.kind === "station_id" ? next : null;
    },
    [placedItems]
  );

  // Tell the host a station ID finished so it archives it and warms a fresh
  // replacement. Best-effort via the host's Neon Auth cookie (same-browser
  // signed-in stage). If the stage tab isn't authenticated the pool simply
  // reuses its existing variations.
  const consumeStationId = useCallback((id: string) => {
    fetch("/api/admin/station-id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ id }),
    }).catch(() => {
      /* best-effort */
    });
  }, []);

  // Arm the lead jingle only on the off→on transition the stage observes, and
  // only if nothing is playing right now — that's the "enabled while stopped"
  // case. Enabling mid-song doesn't arm: the next cadence jingle (already placed
  // in the queue) covers it without cutting off the current track. First load
  // doesn't arm (prev starts null).
  useEffect(() => {
    const prev = prevStationEnabledRef.current;
    prevStationEnabledRef.current = stationIdEnabled;
    if (prev === false && stationIdEnabled) {
      setStationArmed(!isPlayingRef.current);
    } else if (prev && !stationIdEnabled) {
      setStationArmed(false);
    }
  }, [stationIdEnabled]);

  // ── Now-playing publish (cookie auth; no-op when unsigned) ─
  const publishNowPlaying = useCallback(
    (requestId: string | null, playing: boolean) => {
      fetch("/api/admin/playback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ requestId, isPlaying: playing }),
      }).catch(() => {
        /* publishing is best-effort */
      });
    },
    []
  );

  // ── Player controls ──────────────────────────────────────────
  const playCurrent = useCallback(async () => {
    // Armed (station IDs were just enabled while stopped) → open the set with
    // the lead jingle instead of the first track. Consumed once; the
    // [nowPlaying?.id] effect then actually plays it. If the pool is cold (no
    // lead yet) just start the song — jingles still come via cadence.
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
    // Make sure the active deck is audible and the spare silent — unless a
    // crossfade is mid-ramp, which owns the gains.
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
    nowPlaying,
    resume,
    stationArmed,
    activeStationId,
    leadStationId,
    activeEl,
    setDeckGain,
  ]);

  function pauseCurrent() {
    // Pause both decks so a paused crossfade tail doesn't keep playing.
    audioARef.current?.pause();
    audioBRef.current?.pause();
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
      const audio = activeEl();
      if (audio) {
        audio.currentTime = 0;
        void audio.play().then(() => setIsPlaying(true));
      }
    }
  }, [current, readyItems, activeEl]);

  // Decide what happens when the audio element finishes a clip.
  const handleTrackEnded = useCallback(() => {
    // A station ID just finished: archive its real pool row + warm a fresh one,
    // then resume. A "lead" jingle (stationReturnRef === null) hands off to the
    // current track itself; a mid-set jingle advances to the next song (current
    // still points at the one we paused on).
    if (activeStationId) {
      consumeStationId(activeStationId.stationSourceId ?? activeStationId.id);
      const wasLead = stationReturnRef.current === null;
      stationReturnRef.current = null;
      setActiveStationId(null);
      if (wasLead) {
        setIsPlaying(Boolean(current));
      } else {
        advance();
      }
      return;
    }
    // A real song finished. If the server's interleaving puts a jingle right
    // after it, play that next; otherwise advance to the next song. No counter —
    // the queue order is the source of truth.
    const sid = stationIdEnabled ? stationIdAfter(current?.id) : null;
    if (sid) {
      stationReturnRef.current = current?.id ?? null;
      setIsPlaying(false);
      setActiveStationId(sid);
      setIsPlaying(true);
      return;
    }
    advance();
  }, [
    activeStationId,
    advance,
    consumeStationId,
    current,
    stationIdEnabled,
    stationIdAfter,
  ]);

  // ── Crossfade (radio-style overlap) ──────────────────────────
  // Peek the item that will play after the current one — same decision as
  // handleTrackEnded, but computed ahead of the end so we can start it early.
  const peekNext = useCallback((): QueueItem | null => {
    if (activeStationId) {
      const fromId = stationReturnRef.current;
      if (!fromId) {
        return readyItems[0] ?? null;
      }
      const i = readyItems.findIndex((s) => s.id === fromId);
      return readyItems[i + 1] ?? readyItems[0] ?? null;
    }
    const sid = stationIdEnabled ? stationIdAfter(current?.id) : null;
    if (sid) {
      return sid;
    }
    const i = readyItems.findIndex((s) => s.id === current?.id);
    return readyItems[i + 1] ?? readyItems[0] ?? null;
  }, [activeStationId, readyItems, stationIdEnabled, stationIdAfter, current]);

  // Commit the queue to `next` (so lyrics/now-playing follow the incoming deck).
  // Mirrors handleTrackEnded's outcome, but the audio has already been started
  // on the other deck by beginCrossfade.
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
      }
      setCurrentId(next.id);
    },
    [activeStationId, consumeStationId, current]
  );

  // Start `next` on the spare deck, ramp the decks past each other, and promote
  // the spare to active. The outgoing deck is paused once its fade completes.
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
      toEl.volume = masterVolume;
      toEl.muted = muted;
      try {
        toEl.currentTime = 0;
      } catch {
        /* not yet seekable — starts at 0 anyway */
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
    [deckEl, masterVolume, muted, setDeckGain, crossfade, resume, commitNext]
  );

  // Latest crossfade state for the rAF loop to read without restarting it.
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

  // When what's playing changes while we intend to keep playing, (re)start it.
  // Keyed on nowPlaying so switching to/from a station ID triggers playback.
  // Suppressed during a crossfade — the incoming deck is already playing.
  useEffect(() => {
    if (crossfadingRef.current) {
      return;
    }
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
      if (!trackId) {
        void playCurrent();
        return;
      }
      // A Radio ID jingle (pool id) → play it as a one-off, resuming the set
      // when it ends. Pool ids are distinct UUIDs from song ids, so no clash.
      const jingle = (snapshot?.stationIds ?? []).find((s) => s.id === trackId);
      if (jingle) {
        stationReturnRef.current = isPlaying ? current?.id ?? null : null;
        setActiveStationId(jingle);
        setIsPlaying(true);
        return;
      }
      if (trackId !== currentId) {
        setCurrentId(trackId);
        setIsPlaying(true); // the [currentId] effect starts playback
      } else {
        void playCurrent();
      }
    },
    [currentId, playCurrent, snapshot, isPlaying, current]
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
    const ch = createStageChannel(code);
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
  }, [code]);

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
      const audio = activeEl();

      if (audio) {
        if (nowPlaying?.audioUrl && audio.src !== nowPlaying.audioUrl) {
          audio.src = nowPlaying.audioUrl;
        }
        audio.currentTime = nextMs / 1000;
      }
      setPosMs(nextMs);
    },
    [nowPlaying?.audioUrl, totalMs, activeEl]
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
  // The same loop arms the crossfade as the active deck approaches its end.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const audio = activeEl();
      if (audio) {
        setPosMs(audio.currentTime * 1000);

        const cf = crossfadeCtlRef.current;
        if (cf.enabled && !crossfadingRef.current) {
          const dur = audio.duration;
          if (Number.isFinite(dur) && dur > 0) {
            // Clamp the fade so short clips (10s jingles) still blend cleanly.
            const fadeSec = Math.min(CROSSFADE_SEC, dur * 0.4);
            const remaining = dur - audio.currentTime;
            if (remaining <= fadeSec && remaining > 0.08) {
              const next = cf.peek();
              if (next?.audioUrl && next.audioUrl !== audio.src) {
                cf.begin(next, fadeSec);
              }
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, activeEl]);

  // Timed karaoke lines + the line currently being sung. The viewport DOM and
  // scroll positioning live in <KaraokeViewport>.
  const { lyricLines, activeLineIndex } = useLyricsLines(
    nowPlaying?.lyrics,
    posMs
  );

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
            <KaraokeViewport
              lyricLines={lyricLines}
              activeLineIndex={activeLineIndex}
              posMs={posMs}
            />
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
                <div className={styles.requesterRow}>
                  {nowPlaying.requesterAvatarUrl && (
                    /* Plain <img>: account-photo hosts come from the portal, so
                       they can't be enumerated for next/image up front. */
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={nowPlaying.requesterAvatarUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className={styles.requesterAvatar}
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                  <p className={styles.requester}>
                    Requested by {nowPlaying.requesterName}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Hidden audio sources — two decks for crossfade. This tab is the audio
          output for the screenshare; only the active deck drives lyrics/seek. */}
      {(["a", "b"] as Deck[]).map((deck) => (
        <audio
          key={deck}
          ref={deck === "a" ? audioARef : audioBRef}
          crossOrigin="anonymous"
          className="hidden"
          onPlay={() => {
            if (deck === activeDeckRef.current) setIsPlaying(true);
          }}
          onPause={() => {
            if (deck === activeDeckRef.current) setIsPlaying(false);
          }}
          onEnded={() => {
            if (deck === activeDeckRef.current) handleTrackEnded();
          }}
          onLoadedMetadata={(event) => {
            if (deck !== activeDeckRef.current) return;
            setPosMs(0);
            const d = event.currentTarget.duration;
            setDurationMs(Number.isFinite(d) ? d * 1000 : 0);
          }}
          onDurationChange={(event) => {
            if (deck !== activeDeckRef.current) return;
            const d = event.currentTarget.duration;
            setDurationMs(Number.isFinite(d) ? d * 1000 : 0);
          }}
          onTimeUpdate={(event) => {
            if (deck === activeDeckRef.current) {
              setPosMs(event.currentTarget.currentTime * 1000);
            }
          }}
        >
          <track kind="captions" />
        </audio>
      ))}

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
