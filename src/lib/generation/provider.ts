import "server-only";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { decryptSecret } from "@/lib/crypto";
import { getSessionHostKey } from "@/lib/db";
import { optionalEnv, requiredEnv } from "@/lib/env";
import { normalizeLyrics, normalizeMetadata, parseWordTimestamps } from "./lyrics";


export type ProviderError = {
  code: string;
  message: string;
  suggestion?: string;
};


// One client per distinct API key (hosts bring their own; admins share one).
export const clients = new Map<string, ElevenLabsClient>();

export function getClient(apiKey: string): ElevenLabsClient {
  let existing = clients.get(apiKey);
  if (!existing) {
    existing = new ElevenLabsClient({ apiKey });
    clients.set(apiKey, existing);
  }
  return existing;
}


export type KeyResolution =
  | { ok: true; apiKey: string }
  | { ok: false; code: string; message: string };


/**
 * Resolve the ElevenLabs key for a request's host. Host's own key wins; admins
 * fall back to the shared app key; everyone else is blocked with a friendly
 * code so the request fails cleanly instead of hitting ElevenLabs unkeyed.
 */
export async function resolveHostApiKey(sessionId: string): Promise<KeyResolution> {
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


export type ComposeDetailedBody = NonNullable<
  Parameters<ElevenLabsClient["music"]["composeDetailed"]>[0]
>;

export type MusicModel = ComposeDetailedBody["modelId"];

export type OutputFormat = ComposeDetailedBody["outputFormat"];


/**
 * Generation model. Defaults to music_v2 (the current flagship — richer vocals,
 * arrangement, multilingual reliability, mid-song genre switching). Set
 * MUSIC_MODEL=music_v1 to pin the legacy model. Pinning explicitly also keeps
 * us deterministic against the server-side flip of the omitted-model default.
 * NOTE: v2 returns a chunk-based composition plan — normalizeLyrics handles both
 * the v1 `sections` and v2 `chunks` shapes, so karaoke works either way.
 */
export function resolveModel(): MusicModel {
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
export const ALLOWED_MP3_FORMATS = new Set<string>([
  "mp3_22050_32",
  "mp3_24000_48",
  "mp3_44100_32",
  "mp3_44100_64",
  "mp3_44100_96",
  "mp3_44100_128",
  "mp3_44100_192",
]);

export function resolveOutputFormat(): OutputFormat | undefined {
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


export async function composeMusic({
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


/** Collect whatever the SDK returns for audio into a Buffer. */
export async function toBuffer(audio: unknown): Promise<Buffer> {
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


export function parseJson(json: unknown): Record<string, unknown> | null {
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


export function parseProviderError(error: unknown): ProviderError {
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
