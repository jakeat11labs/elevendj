import "server-only";

import type { LyricSection, LyricWord, Lyrics } from "@/lib/status";


export type WordTimestamp = { word: string; startMs: number; endMs: number };


/** Extra song metadata stored in the request's `metadata` jsonb column. */
export type SongMetadataExtras = {
  description: string | null;
  genres: string[];
  languages: string[];
};


/** Pull the word-level timestamps array off the detailed response, if present. */
export function parseWordTimestamps(
  meta: Record<string, unknown> | null
): WordTimestamp[] {
  const raw = meta?.wordsTimestamps ?? meta?.words_timestamps;
  if (!Array.isArray(raw)) return [];
  const words: WordTimestamp[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const word = typeof e.word === "string" ? e.word : "";
    const startMs = Number(e.startMs ?? e.start_ms);
    const endMs = Number(e.endMs ?? e.end_ms);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    words.push({ word, startMs, endMs });
  }
  return words;
}


/**
 * Normalize the song metadata block. Title and explicit flag get promoted to
 * dedicated columns; genres/languages/description ride along in `metadata`
 * jsonb. All values are third-party model output and are treated as plain text.
 */
export function normalizeMetadata(meta: Record<string, unknown> | null): {
  title: string | null;
  isExplicit: boolean;
  songMetadata: SongMetadataExtras;
} {
  const sm = (meta?.songMetadata ?? meta?.song_metadata) as
    | Record<string, unknown>
    | undefined;

  const rawTitle = typeof sm?.title === "string" ? sm.title.trim() : "";
  const title = rawTitle ? rawTitle.slice(0, 200) : null;
  const isExplicit = Boolean(sm?.isExplicit ?? sm?.is_explicit);

  const toStringArray = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter((v) => v.length > 0)
          .slice(0, 20)
      : [];

  const description =
    typeof sm?.description === "string" && sm.description.trim()
      ? sm.description.trim().slice(0, 1000)
      : null;

  return {
    title,
    isExplicit,
    songMetadata: {
      description,
      genres: toStringArray(sm?.genres),
      languages: toStringArray(sm?.languages),
    },
  };
}


/**
 * Normalize the SDK composition plan into our timed-block Lyrics shape, handling
 * BOTH model plan shapes:
 *  - music_v1: res.json.compositionPlan.sections[] = { sectionName, durationMs,
 *    lines: string[] }
 *  - music_v2/music_v2_5: res.json.compositionPlan.chunks[] =
 *    { text, durationMs, ... },
 *    where `text` packs [Section] tags, lyric lines, and {inline directions}.
 * Both reduce to LyricSection[]; word timestamps (model-independent) are then
 * aligned for karaoke. The output shape is identical, so the stage and
 * track-detail UI need no changes regardless of which model generated the song.
 */
export function normalizeLyrics(
  meta: Record<string, unknown> | null,
  words: WordTimestamp[] = []
): Lyrics | null {
  if (!meta) return null;
  const plan = (meta.compositionPlan ?? meta.composition_plan) as
    | Record<string, unknown>
    | undefined;
  if (!plan) return null;

  let sections: LyricSection[];
  if (Array.isArray(plan.sections)) {
    sections = parseV1Sections(plan.sections);
  } else if (Array.isArray(plan.chunks)) {
    sections = parseV2Chunks(plan.chunks);
  } else {
    return null;
  }

  // Vocal if any line is real lyric text (not an "(instrumental)" marker).
  const hasVocal = sections.some((s) =>
    s.lines.some((l) => !isInstrumentalMarker(l.text))
  );
  if (!hasVocal) return null;

  // Annotate absolute startMs/endMs from word timestamps when available; this
  // is best-effort and leaves sections untouched (durationMs fallback) on drift.
  alignSectionsToWords(sections, words);

  return { sections };
}


/** music_v1 plan: explicit sections with sectionName / durationMs / lines[]. */
export function parseV1Sections(rawSections: unknown[]): LyricSection[] {
  const sections: LyricSection[] = [];
  for (const entry of rawSections) {
    if (!entry || typeof entry !== "object") continue;
    const sec = entry as Record<string, unknown>;
    const durationMs = Number(sec.durationMs ?? sec.duration_ms ?? 0) || 0;
    const rawLines = Array.isArray(sec.lines) ? sec.lines : [];
    const lines = rawLines
      .map((l) => (typeof l === "string" ? l.trim() : ""))
      .filter((text) => text.length > 0)
      .map((text) => ({ text }));
    if (lines.length === 0) continue;
    sections.push({
      name:
        typeof sec.sectionName === "string"
          ? sec.sectionName
          : typeof sec.name === "string"
            ? sec.name
            : undefined,
      durationMs,
      lines,
    });
  }
  return sections;
}


/**
 * music_v2/music_v2_5 plan: a chunk list where each generation chunk's `text` carries
 * [Section] tags, lyric lines, and {inline directions}. Audio-reference chunks
 * (inpainting) have no `text` and are skipped. A single chunk may pack multiple
 * [Section] tags, so we emit one LyricSection per tag block and spread the
 * chunk's duration across them (the durationMs fallback only matters when word
 * timestamps are absent; with vocals + withTimestamps they drive timing).
 */
export function parseV2Chunks(chunks: unknown[]): LyricSection[] {
  const out: LyricSection[] = [];
  for (const entry of chunks) {
    if (!entry || typeof entry !== "object") continue;
    const ch = entry as Record<string, unknown>;
    const text = typeof ch.text === "string" ? ch.text : "";
    if (!text) continue; // audio-reference chunk or empty — nothing to render
    const durationMs = Number(ch.durationMs ?? ch.duration_ms ?? 0) || 0;

    const chunkSections: LyricSection[] = [];
    let current: LyricSection | null = null;
    for (const rawLine of text.split(/\r?\n/)) {
      const tag = rawLine.match(/^\s*\[([^\]]+)\]\s*$/);
      if (tag) {
        current = { name: tag[1].trim(), durationMs: 0, lines: [] };
        chunkSections.push(current);
        continue;
      }
      // Drop {inline directions} (e.g. {scratching}); keep the rest as a line.
      const clean = rawLine.replace(/\{[^}]*\}/g, "").trim();
      if (!clean) continue;
      if (!current) {
        current = { durationMs: 0, lines: [] };
        chunkSections.push(current);
      }
      current.lines.push({ text: clean });
    }

    const withLines = chunkSections.filter((s) => s.lines.length > 0);
    if (withLines.length === 0) continue;
    const per = Math.round(durationMs / withLines.length);
    for (const s of withLines) s.durationMs = per;
    out.push(...withLines);
  }
  return out;
}


export function isInstrumentalMarker(text: string): boolean {
  return /^\(?\s*instrumental\b/i.test(text);
}


// A token as it should be rendered (punctuation preserved). `timeable` is true
// when it contains letters/digits, i.e. corresponds to a sung word that should
// consume a timestamp; punctuation-only tokens are rendered but untimed.
export type DisplayToken = { text: string; timeable: boolean };


/** Split a lyric line into render-ready tokens; instrumental markers yield none. */
export function splitDisplayTokens(text: string): DisplayToken[] {
  if (isInstrumentalMarker(text)) return [];
  return text
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => ({
      text: t,
      timeable: t.replace(/[^\p{L}\p{N}]+/gu, "").length > 0,
    }));
}


/**
 * Max relative difference between the lyric token count and the word-timestamp
 * count before we abandon karaoke alignment and fall back to the durationMs
 * path. Tuned against observed responses; tune here if the fallback fires too
 * often. (Note: this is count-based — it can't catch same-count-but-reordered
 * lyric/word streams, which v2's denser lyrics make more likely.)
 */
export const LYRIC_ALIGNMENT_MAX_DIVERGENCE = 0.25;


/**
 * Sequentially assign word timestamps to lyric tokens, building per-word timing
 * (`line.words`) for karaoke fill plus each line's startMs/endMs and each
 * section's startMs. Sequential-by-count is tolerant of spelling differences; a
 * divergence guard skips alignment entirely (preserving the durationMs
 * fallback) when the model's word stream and the composition-plan lyrics don't
 * line up closely.
 */
export function alignSectionsToWords(
  sections: LyricSection[],
  words: WordTimestamp[]
): void {
  if (words.length === 0) return;

  const lineTokens = sections.map((s) =>
    s.lines.map((l) => splitDisplayTokens(l.text))
  );
  const totalTimeable = lineTokens
    .flat()
    .reduce((sum, toks) => sum + toks.filter((t) => t.timeable).length, 0);
  if (totalTimeable === 0) return;

  // Bail out if the two word streams differ by more than the threshold —
  // alignment would drift and produce misleading timings, so we keep the
  // per-section durationMs fallback instead. Log when this fires so the
  // fallback rate is observable rather than silent.
  const divergence =
    Math.abs(totalTimeable - words.length) /
    Math.max(totalTimeable, words.length);
  if (divergence > LYRIC_ALIGNMENT_MAX_DIVERGENCE) {
    console.warn("ElevenDJ: lyric alignment skipped (divergence guard)", {
      lyricTokens: totalTimeable,
      words: words.length,
      divergence: Number(divergence.toFixed(3)),
    });
    return;
  }

  let ptr = 0;
  sections.forEach((section, si) => {
    let sectionStart: number | undefined;
    section.lines.forEach((line, li) => {
      const tokens = lineTokens[si][li];
      if (tokens.length === 0) return;

      const out: LyricWord[] = [];
      let lineStart: number | undefined;
      let lineEnd: number | undefined;
      for (const token of tokens) {
        if (token.timeable && ptr < words.length) {
          const w = words[ptr++];
          out.push({ text: token.text, startMs: w.startMs, endMs: w.endMs });
          if (lineStart === undefined) lineStart = w.startMs;
          lineEnd = w.endMs;
        } else {
          out.push({ text: token.text });
        }
      }

      line.words = out;
      if (lineStart !== undefined) {
        line.startMs = lineStart;
        line.endMs = lineEnd;
        if (sectionStart === undefined) sectionStart = lineStart;
      }
    });
    if (sectionStart !== undefined) section.startMs = sectionStart;
  });
}
