import "server-only";

import { put } from "@vercel/blob";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import {
  claimRequestForGeneration,
  getSessionHostKey,
  markRequestFailed,
  markRequestReady,
} from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { optionalEnv, requiredEnv } from "@/lib/env";
import { buildGenerationPrompt } from "@/lib/security";
import type { Lyrics, LyricSection, LyricWord } from "@/lib/status";

export type GenerationJob = {
  requestId: string;
  source?: "workflow" | "queue" | "after" | "manual";
};

type ProviderError = {
  code: string;
  message: string;
  suggestion?: string;
};

export async function processGenerationJob(job: GenerationJob) {
  const request = await claimRequestForGeneration(job.requestId);
  if (!request) {
    return { ok: true, skipped: true };
  }

  // Resolve which ElevenLabs key powers this generation: the host's own key
  // when present, the shared app key for admins, otherwise fail with a clear
  // message (non-admin host hasn't connected one yet).
  const keyResult = await resolveHostApiKey(request.session_id);
  if (!keyResult.ok) {
    await markRequestFailed(request.id, keyResult.code, keyResult.message);
    return { ok: false, requestId: request.id, error: keyResult.code };
  }

  try {
    // Auto length by default (omit musicLengthMs); songs include sung lyrics
    // unless the requester opted for instrumental.
    const autoDuration = optionalEnv("MUSIC_AUTO_DURATION") !== "false";
    const instrumental = request.force_instrumental;

    const { audio, songId, lyrics, title, isExplicit, songMetadata } =
      await composeMusic({
        apiKey: keyResult.apiKey,
        prompt: buildGenerationPrompt(request.prompt, instrumental),
        durationMs: autoDuration ? null : request.duration_ms,
        instrumental,
      });

    const blobPath = `tracks/${request.id}.mp3`;
    const blob = await put(blobPath, audio, {
      access: "public",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
    });

    await markRequestReady(request.id, blob.url, blob.pathname, songId, lyrics, {
      title,
      isExplicit,
      songMetadata,
    });
    return { ok: true, requestId: request.id };
  } catch (error) {
    console.error("ElevenDJ generation failed", error);
    const providerError = parseProviderError(error);
    await markRequestFailed(
      request.id,
      providerError.code,
      providerError.message,
      providerError.suggestion
    );
    return { ok: false, requestId: request.id, error: providerError.code };
  }
}

// One client per distinct API key (hosts bring their own; admins share one).
const clients = new Map<string, ElevenLabsClient>();
function getClient(apiKey: string): ElevenLabsClient {
  let existing = clients.get(apiKey);
  if (!existing) {
    existing = new ElevenLabsClient({ apiKey });
    clients.set(apiKey, existing);
  }
  return existing;
}

type KeyResolution =
  | { ok: true; apiKey: string }
  | { ok: false; code: string; message: string };

/**
 * Resolve the ElevenLabs key for a request's host. Host's own key wins; admins
 * fall back to the shared app key; everyone else is blocked with a friendly
 * code so the request fails cleanly instead of hitting ElevenLabs unkeyed.
 */
async function resolveHostApiKey(sessionId: string): Promise<KeyResolution> {
  const host = await getSessionHostKey(sessionId);
  if (!host) {
    return {
      ok: false,
      code: "session_not_found",
      message: "This session no longer exists.",
    };
  }
  if (host.keyCiphertext) {
    try {
      return { ok: true, apiKey: decryptSecret(host.keyCiphertext) };
    } catch {
      return {
        ok: false,
        code: "host_key_unreadable",
        message:
          "The host's ElevenLabs key couldn't be read. They'll need to reconnect it.",
      };
    }
  }
  if (host.isAdmin) {
    return { ok: true, apiKey: requiredEnv("ELEVENLABS_API_KEY") };
  }
  return {
    ok: false,
    code: "host_key_missing",
    message: "The host hasn't connected an ElevenLabs API key yet.",
  };
}

type ComposeDetailedBody = NonNullable<
  Parameters<ElevenLabsClient["music"]["composeDetailed"]>[0]
>;
type MusicModel = ComposeDetailedBody["modelId"];
type OutputFormat = ComposeDetailedBody["outputFormat"];

/**
 * Generation model. Defaults to music_v2 (the current flagship — richer vocals,
 * arrangement, multilingual reliability, mid-song genre switching). Set
 * MUSIC_MODEL=music_v1 to pin the legacy model. Pinning explicitly also keeps
 * us deterministic against the server-side flip of the omitted-model default.
 * NOTE: v2 returns a chunk-based composition plan — normalizeLyrics handles both
 * the v1 `sections` and v2 `chunks` shapes, so karaoke works either way.
 */
function resolveModel(): MusicModel {
  return (optionalEnv("MUSIC_MODEL") === "music_v1"
    ? "music_v1"
    : "music_v2") as MusicModel;
}

// Output format (codec_samplerate_bitrate) trades blob size against quality.
// Only mp3 formats are valid here: the blob is written as .mp3 / audio/mpeg and
// C2PA signing is mp3-only. An unknown/typo'd value is ignored (falls back to
// the API default mp3_44100_128) instead of being sent blind and failing the
// whole generation. mp3_44100_64 ~halves blob size; mp3_44100_192 needs the
// host's key to be Creator tier or above.
const ALLOWED_MP3_FORMATS = new Set<string>([
  "mp3_22050_32",
  "mp3_24000_48",
  "mp3_44100_32",
  "mp3_44100_64",
  "mp3_44100_96",
  "mp3_44100_128",
  "mp3_44100_192",
]);
function resolveOutputFormat(): OutputFormat | undefined {
  const fmt = optionalEnv("MUSIC_OUTPUT_FORMAT");
  if (!fmt) return undefined;
  if (!ALLOWED_MP3_FORMATS.has(fmt)) {
    console.warn(
      `ElevenDJ: ignoring unsupported MUSIC_OUTPUT_FORMAT="${fmt}" (expected one of ${[
        ...ALLOWED_MP3_FORMATS,
      ].join(", ")})`
    );
    return undefined;
  }
  return fmt as OutputFormat;
}

async function composeMusic({
  apiKey,
  prompt,
  durationMs,
  instrumental,
}: {
  apiKey: string;
  prompt: string;
  durationMs: number | null;
  instrumental: boolean;
}) {
  // Detailed compose returns the audio plus the composition plan + metadata,
  // which carries the lyrics (and per-section timing) when the song has vocals.
  const outputFormat = resolveOutputFormat();
  // Sign generated mp3s with C2PA content-provenance metadata when enabled —
  // a useful trust/labeling signal for public, listener-generated music.
  const signWithC2Pa = optionalEnv("MUSIC_SIGN_C2PA") === "true";
  // Retain the generated song server-side so its songId can later be referenced
  // for inpainting / remix. Default OFF: this is an enterprise-gated feature, and
  // setting it on a host's non-enterprise key would fail the whole generation.
  // The songId header is captured regardless; this only controls retention.
  const storeForInpainting =
    optionalEnv("MUSIC_STORE_FOR_INPAINTING") === "true";
  const result = await getClient(apiKey).music.composeDetailed({
    prompt,
    modelId: resolveModel(),
    forceInstrumental: instrumental,
    // Word-level timestamps let the stage sync lyric blocks precisely instead
    // of approximating from per-section durations. Only meaningful with vocals.
    withTimestamps: !instrumental,
    ...(durationMs != null ? { musicLengthMs: durationMs } : {}),
    ...(outputFormat ? { outputFormat } : {}),
    ...(signWithC2Pa ? { signWithC2Pa: true } : {}),
    ...(storeForInpainting ? { storeForInpainting: true } : {}),
  });

  const res = result as unknown as {
    audio: unknown;
    json?: unknown;
    filename?: string;
    songId?: string;
  };

  const audio = await toBuffer(res.audio);
  const meta = parseJson(res.json);
  // The wrapper camelCases every key of the multipart JSON at runtime, so word
  // timestamps arrive as `wordsTimestamps: { word, startMs, endMs }[]` even
  // though the wrapper's static type omits them. The snake_case reads in the
  // parsers below are a defensive guard against that normalization changing,
  // not a live code path today.
  const words = parseWordTimestamps(meta);
  const lyrics = instrumental ? null : normalizeLyrics(meta, words);
  // The `song-id` response header is returned for normal generations too (kept
  // for a future remix/inpainting feature); it's only usable for inpainting
  // when the song was retained via storeForInpainting above.
  const songId = typeof res.songId === "string" ? res.songId : null;
  const { title, isExplicit, songMetadata } = normalizeMetadata(meta);

  if (!instrumental && !lyrics) {
    // Surface the shape once so we can confirm parsing against real responses.
    console.log(
      "ElevenDJ: no lyrics parsed; detailed json keys:",
      meta ? Object.keys(meta) : null
    );
  }

  return { audio, songId, lyrics, title, isExplicit, songMetadata };
}

export type WordTimestamp = { word: string; startMs: number; endMs: number };

/** Extra song metadata stored in the request's `metadata` jsonb column. */
export type SongMetadataExtras = {
  description: string | null;
  genres: string[];
  languages: string[];
};

/** Pull the word-level timestamps array off the detailed response, if present. */
function parseWordTimestamps(
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
function normalizeMetadata(meta: Record<string, unknown> | null): {
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

/** Collect whatever the SDK returns for audio into a Buffer. */
async function toBuffer(audio: unknown): Promise<Buffer> {
  if (!audio) {
    throw new Error("No audio returned from compose");
  }
  if (Buffer.isBuffer(audio)) {
    return audio;
  }
  if (audio instanceof Uint8Array) {
    return Buffer.from(audio);
  }
  if (typeof (audio as { arrayBuffer?: unknown }).arrayBuffer === "function") {
    return Buffer.from(await (audio as Blob).arrayBuffer());
  }
  if (typeof (audio as { getReader?: unknown }).getReader === "function") {
    const reader = (audio as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  if (
    typeof (audio as { [Symbol.asyncIterator]?: unknown })[
      Symbol.asyncIterator
    ] === "function"
  ) {
    const chunks: Buffer[] = [];
    for await (const chunk of audio as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("Unsupported audio type from compose");
}

function parseJson(json: unknown): Record<string, unknown> | null {
  if (!json) return null;
  if (typeof json === "string") {
    try {
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof json === "object") {
    return json as Record<string, unknown>;
  }
  return null;
}

/**
 * Normalize the SDK composition plan into our timed-block Lyrics shape, handling
 * BOTH model plan shapes:
 *  - music_v1: res.json.compositionPlan.sections[] = { sectionName, durationMs,
 *    lines: string[] }
 *  - music_v2: res.json.compositionPlan.chunks[] = { text, durationMs, ... },
 *    where `text` packs [Section] tags, lyric lines, and {inline directions}.
 * Both reduce to LyricSection[]; word timestamps (model-independent) are then
 * aligned for karaoke. The output shape is identical, so the stage and
 * track-detail UI need no changes regardless of which model generated the song.
 */
function normalizeLyrics(
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
function parseV1Sections(rawSections: unknown[]): LyricSection[] {
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
 * music_v2 plan: a chunk list where each generation chunk's `text` carries
 * [Section] tags, lyric lines, and {inline directions}. Audio-reference chunks
 * (inpainting) have no `text` and are skipped. A single chunk may pack multiple
 * [Section] tags, so we emit one LyricSection per tag block and spread the
 * chunk's duration across them (the durationMs fallback only matters when word
 * timestamps are absent; with vocals + withTimestamps they drive timing).
 */
function parseV2Chunks(chunks: unknown[]): LyricSection[] {
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

function isInstrumentalMarker(text: string): boolean {
  return /^\(?\s*instrumental\b/i.test(text);
}

// A token as it should be rendered (punctuation preserved). `timeable` is true
// when it contains letters/digits, i.e. corresponds to a sung word that should
// consume a timestamp; punctuation-only tokens are rendered but untimed.
type DisplayToken = { text: string; timeable: boolean };

/** Split a lyric line into render-ready tokens; instrumental markers yield none. */
function splitDisplayTokens(text: string): DisplayToken[] {
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
const LYRIC_ALIGNMENT_MAX_DIVERGENCE = 0.25;

/**
 * Sequentially assign word timestamps to lyric tokens, building per-word timing
 * (`line.words`) for karaoke fill plus each line's startMs/endMs and each
 * section's startMs. Sequential-by-count is tolerant of spelling differences; a
 * divergence guard skips alignment entirely (preserving the durationMs
 * fallback) when the model's word stream and the composition-plan lyrics don't
 * line up closely.
 */
function alignSectionsToWords(
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

function parseProviderError(error: unknown): ProviderError {
  const fallback: ProviderError = {
    code: "generation_failed",
    message: "The song could not be generated. Try another request.",
  };

  const statusCode = (error as { statusCode?: number })?.statusCode;
  const body = (error as { body?: unknown })?.body;
  const detail = (body as { detail?: unknown })?.detail;

  // FastAPI validation errors (HTTP 422) put an ARRAY of { loc, msg, type } on
  // `detail`. Surface the joined messages instead of the generic fallback.
  if (Array.isArray(detail)) {
    const message = detail
      .map((d) => (d as { msg?: unknown })?.msg)
      .filter((m): m is string => typeof m === "string" && m.length > 0)
      .join("; ");
    return { code: "validation_error", message: message || fallback.message };
  }

  const d = detail as
    | {
        status?: string;
        message?: string;
        data?: {
          prompt_suggestion?: string;
          composition_plan_suggestion?: string;
        };
      }
    | undefined;

  // bad_prompt is surfaced to the requester with the model's suggested rewrite.
  if (d?.status === "bad_prompt") {
    return {
      code: "bad_prompt",
      message:
        d.message ||
        "This request was rejected because it referenced protected material.",
      suggestion: d.data?.prompt_suggestion,
    };
  }

  // Any other structured status (incl. bad_composition_plan once plans are used)
  // — carry the message and a suggestion if one is present.
  if (d?.status) {
    return {
      code: d.status,
      message: d.message || fallback.message,
      suggestion: d.data?.composition_plan_suggestion,
    };
  }

  // No structured detail — map the raw HTTP status to a meaningful code so the
  // failure isn't flattened into the generic fallback.
  if (statusCode === 401) {
    return {
      code: "auth_failed",
      message: "The ElevenLabs API key was rejected. Reconnect a valid key.",
    };
  }
  if (statusCode === 403) {
    return {
      code: "forbidden",
      message:
        "The ElevenLabs key isn't permitted to generate music (plan or access).",
    };
  }
  if (statusCode === 429) {
    return {
      code: "rate_limited",
      message: "ElevenLabs is rate-limiting this key. Try again shortly.",
    };
  }

  return fallback;
}
