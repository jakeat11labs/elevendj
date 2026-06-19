import { useMemo } from "react";

import type { Lyrics, LyricWord } from "@/lib/status";

/** A single lyric line flattened onto the song's absolute timeline. */
export type KaraokeLine = {
  key: string;
  words?: LyricWord[];
  text: string;
  startMs: number;
};

/**
 * Flatten a song's lyric sections into one timed list with an absolute startMs
 * per line, so a continuous karaoke scroll can run instead of swapping whole
 * blocks. Prefers real per-line/word timestamps; falls back to spreading each
 * section's duration evenly across its lines. Also returns `activeLineIndex` —
 * the last line whose start has passed `posMs`.
 */
export function useLyricsLines(
  lyrics: Lyrics | null | undefined,
  posMs: number
): { lyricLines: KaraokeLine[] | null; activeLineIndex: number } {
  const lyricLines = useMemo(() => {
    const sections = lyrics?.sections;
    if (!sections || sections.length === 0) return null;

    const out: KaraokeLine[] = [];

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
        out.push({
          key: `${si}-${li}`,
          words: line.words,
          text: line.text,
          startMs,
        });
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
  }, [lyrics]);

  // Index of the line currently being sung (last line whose start has passed).
  const activeLineIndex = useMemo(() => {
    if (!lyricLines || lyricLines.length === 0) return 0;
    let idx = 0;
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].startMs <= posMs) idx = i;
    }
    return idx;
  }, [lyricLines, posMs]);

  return { lyricLines, activeLineIndex };
}
