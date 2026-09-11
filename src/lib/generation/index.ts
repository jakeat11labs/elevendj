import "server-only";

import { del, put } from "@vercel/blob";
import { claimRequestForGeneration, getStationIdConfig, markRequestFailed, markRequestReady } from "@/lib/db";
import { optionalEnv } from "@/lib/env";
import { buildGenerationPrompt } from "@/lib/security";
import { STATION_ID_DURATION_MS, buildStationIdPrompt } from "@/lib/station-id";
import { composeMusic, parseProviderError, resolveHostApiKey } from "./provider";


export type GenerationJob = {
  requestId: string;
  source?: "workflow" | "queue" | "after" | "manual";
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

  let uploadedBlobUrl: string | null = null;
  try {
    // Station IDs are their own thing: a fixed ~10s vocal "radio ID" with an
    // ad-libbed prompt, ignoring the room's auto-duration setting. Everything
    // else (audience song requests) keeps the existing behavior: auto length by
    // default, sung lyrics unless the requester opted for instrumental.
    const isStationId = request.kind === "station_id";
    const autoDuration = optionalEnv("MUSIC_AUTO_DURATION") !== "false";
    const instrumental = isStationId ? false : request.force_instrumental;

    let prompt: string;
    let durationMs: number | null;
    if (isStationId) {
      const config = await getStationIdConfig(request.session_id);
      const hostName =
        config?.personalize && config.hostName ? config.hostName : null;
      prompt = buildStationIdPrompt(hostName);
      durationMs = STATION_ID_DURATION_MS;
    } else {
      prompt = buildGenerationPrompt(
        request.prompt,
        instrumental,
        request.style_id
      );
      durationMs = autoDuration ? null : request.duration_ms;
    }

    const { audio, songId, lyrics, title, isExplicit, songMetadata } =
      await composeMusic({
        apiKey: keyResult.apiKey,
        prompt,
        durationMs,
        instrumental,
      });

    const blobPath = `tracks/${request.id}.mp3`;
    const blob = await put(blobPath, audio, {
      access: "public",
      contentType: "audio/mpeg",
      addRandomSuffix: false,
    });
    uploadedBlobUrl = blob.url;

    const committed = await markRequestReady(
      request.id,
      blob.url,
      blob.pathname,
      songId,
      lyrics,
      {
        title,
        isExplicit,
        songMetadata,
      }
    );
    if (!committed) {
      // An operator archived the request while generation was in flight. The
      // conditional DB write intentionally lost; remove the orphaned blob too.
      await del(blob.url);
      uploadedBlobUrl = null;
      return { ok: true, skipped: true, requestId: request.id };
    }
    uploadedBlobUrl = null;
    return { ok: true, requestId: request.id };
  } catch (error) {
    if (uploadedBlobUrl) {
      try {
        await del(uploadedBlobUrl);
      } catch (cleanupError) {
        console.error("Failed to remove orphaned generation blob", cleanupError);
      }
    }
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

// Public lyric/metadata types, re-exported to preserve the @/lib/generation surface.
export type { WordTimestamp, SongMetadataExtras } from "./lyrics";
