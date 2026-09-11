"use client";

import {
  useCallback,
  useEffect,
  useState,
  type RefObject,
} from "react";
import { Maximize2, Minimize2, Pause, Play, Volume2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { ReactiveOrb } from "@/components/orb/ReactiveOrb";
import type { QueueItem } from "@/lib/status";
import type { PlayerStateResponse } from "./use-remote-playback";
import styles from "./cancun-player.module.css";

const OFFSITE_PORTAL_URL = "https://elevencancun2026.lovable.app";
const CANCUN_TIME_ZONE = "America/Cancun";

function requestUrlFor(session: PlayerStateResponse["session"]): string {
  const url = new URL(session?.portalRequestUrl || OFFSITE_PORTAL_URL);
  // The portal will use this as a room hint after login, then validate the live
  // session server-side. It remains the same request page employees open from
  // inside the app; the QR only removes ambiguity when rooms run concurrently.
  if (session?.externalSessionId) {
    url.searchParams.set("session", session.externalSessionId);
  }
  return url.toString();
}

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

function ElevenMark() {
  return (
    <svg
      viewBox="0 0 101 160"
      role="img"
      aria-label="ElevenLabs"
      width="25"
      height="40"
    >
      <path d="M34.0463 160H0.5V0H34.0463V160Z" fill="currentColor" />
      <path d="M100.5 160H66.9537V0H100.5V160Z" fill="currentColor" />
    </svg>
  );
}

function useVenueTime() {
  const [time, setTime] = useState("");

  useEffect(() => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: CANCUN_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
    });
    const tick = () =>
      setTime(formatter.format(new Date()).toLowerCase().replace(/\s/g, ""));
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  return time;
}

/** Hold a wall display awake while the player is open. */
function useWakeLock() {
  useEffect(() => {
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) return;
    let cancelled = false;
    let lock: WakeLockSentinelLike | null = null;

    const request = async () => {
      if (cancelled || document.visibilityState !== "visible" || lock) return;
      try {
        const next = await nav.wakeLock?.request("screen");
        if (!next) return;
        if (cancelled) {
          void next.release();
          return;
        }
        lock = next;
        next.addEventListener("release", () => {
          lock = null;
        });
      } catch {
        // A browser without permission still plays normally.
      }
    };

    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (lock && !lock.released) void lock.release();
      lock = null;
    };
  }, []);
}

export function CancunPlayerScreen({
  analyserRef,
  texture,
  saturation,
  deviceName,
  session,
  current,
  audioUnlocked,
  localPlaying,
  revision,
  onEnableAudio,
}: {
  analyserRef: RefObject<AnalyserNode | null>;
  texture: string;
  saturation: number;
  deviceName: string;
  session: PlayerStateResponse["session"];
  current: QueueItem | null;
  audioUnlocked: boolean;
  localPlaying: boolean;
  revision: number;
  onEnableAudio: () => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const venueTime = useVenueTime();
  useWakeLock();

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }, []);

  const requestUrl = requestUrlFor(session);
  const unassigned = !session;
  const title = unassigned
    ? "Waiting for room assignment"
    : current?.title || current?.prompt || "Music is warming up";
  const showPrompt = current?.title && current.prompt !== current.title;

  return (
    <div className={styles.screen}>
      <div className={styles.noise} aria-hidden="true" />

      <div className={styles.shell}>
        <header className={styles.brand}>
          <div className={styles.brandLockup}>
            <ElevenMark />
            <div>
              <p className={styles.eventName}>Cancún 2026</p>
              <p className={styles.eventLine}>ElevenLabs Company Offsite</p>
            </div>
          </div>

          <div className={styles.roomMeta}>
            {session && (
              <span className={styles.livePill}>
                <span className={styles.liveDot} aria-hidden="true" />
                Live
              </span>
            )}
            <div className={styles.roomLabel}>
              <p className={styles.roomName}>
                {session?.roomName || session?.name || "Awaiting room"}
              </p>
              <p className={styles.deviceName}>{deviceName}</p>
            </div>
            {venueTime && (
              <div className={styles.venueTime} aria-label={`Cancún time ${venueTime}`}>
                <span className={styles.venueLabel}>Cancún local time</span>
                <span className={styles.venueValue}>{venueTime}</span>
              </div>
            )}
          </div>
        </header>

        <main className={styles.hero}>
          <section className={styles.copy}>
            <p className={styles.nowPlaying}>
              {unassigned ? "Player ready" : "Now playing"}
            </p>
            <h1 className={styles.title}>{title}</h1>
            {showPrompt && <p className={styles.prompt}>{current.prompt}</p>}

            {current?.requesterName && (
              <div className={styles.requester}>
                {current.requesterAvatarUrl && (
                  /* The authenticated portal may use any account-photo host. */
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={current.requesterAvatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className={styles.avatar}
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                )}
                <div className={styles.requesterText}>
                  <span className={styles.requestedBy}>Requested by</span>
                  <span className={styles.requesterName}>
                    {current.requesterName}
                  </span>
                </div>
              </div>
            )}
          </section>

          <div className={styles.orbStage} aria-hidden="true">
            <div className={styles.orbHalo} />
            <div className={styles.orb}>
              <ReactiveOrb
                analyserRef={analyserRef}
                texture={texture}
                saturation={saturation}
              />
            </div>
          </div>
        </main>

        <footer className={styles.footer}>
          <div className={styles.statusArea}>
            {!audioUnlocked ? (
              <button
                type="button"
                onClick={onEnableAudio}
                className={styles.audioButton}
              >
                <Volume2 size={16} />
                Enable audio
              </button>
            ) : (
              <span className={styles.statusPill}>
                {localPlaying ? <Pause size={15} /> : <Play size={15} />}
                {localPlaying ? "Playing" : "Paused"}
                <span className={styles.revision}>rev {revision}</span>
              </span>
            )}
            <button
              type="button"
              className={styles.fullscreen}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              <span className="sr-only">
                {fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              </span>
            </button>
          </div>

          <div className={styles.qrCard}>
            <QRCodeSVG
              value={requestUrl}
              size={118}
              marginSize={0}
              level="M"
              bgColor="transparent"
              fgColor="#1E1916"
              className={styles.qr}
              aria-label="QR code to request a song in the Offsite app"
            />
            <div className={styles.qrCopy}>
              <span className={styles.qrLabel}>Scan to request</span>
              <span className={styles.qrTitle}>Pick the next track</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
