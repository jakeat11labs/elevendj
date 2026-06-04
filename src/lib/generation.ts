import "server-only";

import { put } from "@vercel/blob";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import {
  claimRequestForGeneration,
  markRequestFailed,
  markRequestReady,
} from "@/lib/db";
import { optionalEnv, requiredEnv } from "@/lib/env";
import { buildGenerationPrompt } from "@/lib/security";
import type { Lyrics, LyricSection } from "@/lib/status";

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

  try {
    // Auto length by default (omit musicLengthMs); songs include sung lyrics
    // unless the requester opted for instrumental.
    const autoDuration = optionalEnv("MUSIC_AUTO_DURATION") !== "false";
    const instrumental = request.force_instrumental;

    const { audio, songId, lyrics } = await composeMusic({
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

    await markRequestReady(request.id, blob.url, blob.pathname, songId, lyrics);
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

let client: ElevenLabsClient | null = null;
function getClient(): ElevenLabsClient {
  if (!client) {
    requiredEnv("ELEVENLABS_API_KEY"); // fail fast with a clear message
    client = new ElevenLabsClient();
  }
  return client;
}

async function composeMusic({
  prompt,
  durationMs,
  instrumental,
}: {
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
  const result = await getClient().music.composeDetailed({
    prompt,
    forceInstrumental: instrumental,
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
  const lyrics = instrumental ? null : normalizeLyrics(meta);
  const songId = typeof res.songId === "string" ? res.songId : null;

  if (!instrumental && !lyrics) {
    // Surface the shape once so we can confirm parsing against real responses.
    console.log(
      "ElevenDJ: no lyrics parsed; detailed json keys:",
      meta ? Object.keys(meta) : null
    );
  }

  return { audio, songId, lyrics };
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
function normalizeLyrics(meta: Record<string, unknown> | null): Lyrics | null {
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
    s.lines.some((l) => !/^\(?\s*instrumental\b/i.test(l.text))
  );
  if (!hasVocal) return null;

  return { sections };
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
