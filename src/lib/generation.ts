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
  // Output format (codec_samplerate_bitrate) is configurable to trade blob
  // size against quality; default (unset) is the API default mp3_44100_128.
  // mp3_44100_64 roughly halves file size; mp3_44100_192 needs Creator tier.
  const outputFormat = optionalEnv("MUSIC_OUTPUT_FORMAT");
  const result = await getClient(apiKey).music.composeDetailed({
    prompt,
    forceInstrumental: instrumental,
    // Word-level timestamps let the stage sync lyric blocks precisely instead
    // of approximating from per-section durations. Only meaningful with vocals.
    withTimestamps: !instrumental,
    ...(durationMs != null ? { musicLengthMs: durationMs } : {}),
    ...(outputFormat
      ? {
          outputFormat: outputFormat as NonNullable<
            Parameters<ElevenLabsClient["music"]["composeDetailed"]>[0]
          >["outputFormat"],
        }
      : {}),
  });

  const res = result as unknown as {
    audio: unknown;
    json?: unknown;
    filename?: string;
    songId?: string;
  };

  const audio = await toBuffer(res.audio);
  const meta = parseJson(res.json);
  // The SDK camelCases the multipart JSON, so word timestamps arrive as
  // `wordsTimestamps: { word, startMs, endMs }[]` even though the wrapper's
  // TypeScript type omits them.
  const words = parseWordTimestamps(meta);
  const lyrics = instrumental ? null : normalizeLyrics(meta, words);
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
 * Normalize the SDK composition plan into our timed-block Lyrics shape.
 * Shape: res.json.compositionPlan.sections[] = { sectionName, durationMs,
 * lines: string[] } — `lines` are plain lyric strings.
 */
function normalizeLyrics(
  meta: Record<string, unknown> | null,
  words: WordTimestamp[] = []
): Lyrics | null {
  if (!meta) return null;
  const plan = (meta.compositionPlan ?? meta.composition_plan) as
    | Record<string, unknown>
    | undefined;
  const rawSections = plan?.sections;
  if (!Array.isArray(rawSections)) return null;

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

  // Bail out if the two word streams differ by more than 25% — alignment would
  // drift and produce misleading timings.
  const divergence =
    Math.abs(totalTimeable - words.length) /
    Math.max(totalTimeable, words.length);
  if (divergence > 0.25) return;

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

  const body = (error as { body?: unknown })?.body;
  const detail = (
    body as {
      detail?: {
        status?: string;
        message?: string;
        data?: { prompt_suggestion?: string };
      };
    }
  )?.detail;

  if (detail?.status === "bad_prompt") {
    return {
      code: "bad_prompt",
      message:
        detail.message ||
        "This request was rejected because it referenced protected material.",
      suggestion: detail.data?.prompt_suggestion,
    };
  }

  if (detail?.status) {
    return { code: detail.status, message: fallback.message };
  }

  return fallback;
}
