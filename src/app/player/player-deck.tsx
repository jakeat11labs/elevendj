"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Pause, Play, RefreshCcw, SkipForward } from "lucide-react";

import { AudioMeters } from "@/components/audio-meters";
import { StatusBadge } from "@/components/status-badge";
import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import type { QueueItem, QueueSnapshot } from "@/lib/status";

export function PlayerDeck() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshQueue = useCallback(async () => {
    const response = await fetch("/api/queue");
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || "Queue unavailable.");
      return;
    }
    setSnapshot((await response.json()) as QueueSnapshot);
    setError(null);
  }, []);

  useRealtimeRefresh(refreshQueue);

  useEffect(() => {
    refreshQueue();
    const interval = window.setInterval(refreshQueue, 5000);
    return () => window.clearInterval(interval);
  }, [refreshQueue]);

  const readyItems = useMemo(
    () => snapshot?.items.filter((item) => item.status === "ready" && item.audioUrl) ?? [],
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

  async function playCurrent() {
    if (!audioRef.current || !current?.audioUrl) {
      return;
    }
    audioRef.current.src = current.audioUrl;
    await audioRef.current.play();
    setIsPlaying(true);
  }

  function pauseCurrent() {
    audioRef.current?.pause();
    setIsPlaying(false);
  }

  function skip() {
    if (readyItems.length === 0) {
      return;
    }
    const index = readyItems.findIndex((item) => item.id === current?.id);
    const next = readyItems[(index + 1) % readyItems.length];
    if (next) {
      setCurrentId(next.id);
      setIsPlaying(false);
    }
  }

  useEffect(() => {
    if (isPlaying) {
      playCurrent().catch(() => setIsPlaying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-5 pb-14 pt-2 sm:px-8 lg:grid-cols-[1fr_360px]">
      <section className="card-glass rise relative grid overflow-hidden rounded-[1.5rem] p-6 sm:p-9">
        {/* Coral orb glows behind the now-playing track */}
        <Image
          src="/brand/orb-coral.jpg"
          alt=""
          width={560}
          height={560}
          aria-hidden
          className={`voice-orb pointer-events-none absolute -right-28 -top-28 h-96 w-96 transition-opacity duration-700 ${
            isPlaying ? "opacity-95" : "opacity-30"
          }`}
        />

        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow mb-3">Now playing</p>
            <h1 className="display max-w-2xl text-4xl sm:text-[3.25rem]">
              {current ? current.prompt : "Waiting for a ready track"}
            </h1>
          </div>
          <AudioMeters active={isPlaying} />
        </div>

        <div className="card-flat relative mt-8 self-end rounded-[var(--radius-lg)] p-5">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Selected</p>
              <p className="mt-1 text-lg" style={{ fontFamily: "var(--font-brand)" }}>
                {current?.requesterName || "Anonymous"}
                {current?.position ? (
                  <span className="mono text-white/45"> · #{current.position}</span>
                ) : null}
              </p>
            </div>
            {current && <StatusBadge status={current.status} />}
          </div>

          <audio
            ref={audioRef}
            className="w-full"
            controls
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            onEnded={skip}
          >
            <track kind="captions" />
          </audio>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={isPlaying ? pauseCurrent : playCurrent}
              disabled={!current?.audioUrl}
              className="btn-primary inline-flex h-12 items-center gap-2 px-6 disabled:opacity-40"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              onClick={skip}
              disabled={readyItems.length < 2}
              className="btn-ghost inline-flex h-12 items-center gap-2 px-5 disabled:opacity-40"
            >
              <SkipForward size={18} />
              Next
            </button>
            <button
              type="button"
              onClick={refreshQueue}
              className="btn-ghost inline-flex h-12 items-center gap-2 px-5"
            >
              <RefreshCcw size={18} />
              Refresh
            </button>
          </div>
        </div>
      </section>

      <aside className="card-glass rise rounded-[1.5rem] p-5 sm:p-6" style={{ animationDelay: "90ms" }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl" style={{ fontFamily: "var(--font-brand)" }}>
            Queue
          </h2>
          <span className="mono text-sm text-white/45">
            {snapshot?.items.length ?? 0}
          </span>
        </div>
        {error && (
          <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--destructive)]/45 bg-[var(--destructive)]/12 p-3 text-sm text-white/90">
            {error}
          </div>
        )}
        <div className="space-y-2.5">
          {(snapshot?.items ?? []).map((item: QueueItem) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCurrentId(item.id)}
              className={`card-flat w-full rounded-[var(--radius-md)] p-3 text-left transition ${
                item.id === current?.id
                  ? "border-white/45 bg-white/10"
                  : ""
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="mono text-xs text-white/40">
                  #{item.position ?? "--"}
                </span>
                <StatusBadge status={item.status} />
              </div>
              <p className="line-clamp-2 text-sm text-white/85">{item.prompt}</p>
            </button>
          ))}
          {(snapshot?.items.length ?? 0) === 0 && !error && (
            <p className="px-1 py-6 text-center text-sm text-white/35">
              No requests yet.
            </p>
          )}
        </div>
      </aside>
    </main>
  );
}
