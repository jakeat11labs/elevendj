"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import type { LyricWord } from "@/lib/status";
import type { KaraokeLine } from "@/lib/use-lyrics";

// Render a lyric line as karaoke: words fill from dim to bright as playback
// passes each word's start. Punctuation-only tokens (no startMs) inherit the
// state of the word before them so commas don't flicker ahead of their word.
function renderKaraokeLine(
  words: LyricWord[],
  posMs: number,
  tone: "dark" | "light"
) {
  let lastSung = false;
  return words.map((word, wi) => {
    if (typeof word.startMs === "number") lastSung = posMs >= word.startMs;
    const color =
      tone === "light"
        ? lastSung
          ? "#1E1916"
          : "rgba(30,25,22,0.24)"
        : lastSung
          ? "#ffffff"
          : "rgba(255,255,255,0.30)";
    return (
      <span
        key={wi}
        style={{ color, transition: "color 150ms linear" }}
      >
        {word.text}
        {wi < words.length - 1 ? " " : ""}
      </span>
    );
  });
}

/**
 * Fixed-height karaoke window. Lines stay large; the stack slides up as the song
 * advances so only a few lines show at once and long verses never run off-screen.
 * The active line is anchored ~38% down the window.
 */
export function KaraokeViewport({
  lyricLines,
  activeLineIndex,
  posMs,
  tone = "dark",
}: {
  lyricLines: KaraokeLine[];
  activeLineIndex: number;
  posMs: number;
  tone?: "dark" | "light";
}) {
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

  return (
    <div className="flex w-full max-w-4xl flex-col items-center gap-5">
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
            transition: "transform 600ms cubic-bezier(0.22, 0.61, 0.36, 1)",
          }}
        >
          {lyricLines.map((line, i) => {
            const isActive = i === activeLineIndex;
            const color =
              tone === "light"
                ? i < activeLineIndex
                  ? "rgba(30,25,22,0.38)"
                  : "rgba(30,25,22,0.22)"
                : i < activeLineIndex
                  ? "rgba(255,255,255,0.35)"
                  : "rgba(255,255,255,0.25)";
            return (
              <p
                key={line.key}
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                className="text-balance transition-[color,opacity] duration-500"
                style={isActive ? undefined : { color }}
              >
                {isActive && line.words?.length
                  ? renderKaraokeLine(line.words, posMs, tone)
                  : line.text}
              </p>
            );
          })}
        </div>
      </div>
    </div>
  );
}
