import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { songRequests } from "@/lib/db/schema";
import type { Lyrics, RequestStatus } from "@/lib/status";
import { dbCall, recordEvent, toRecord } from "./internal";


// ─────────────────────────────────────────────────────────────────
// Generation worker (operates by request id; no host scoping)
// ─────────────────────────────────────────────────────────────────

export async function claimRequestForGeneration(id: string) {
  return dbCall(async () => {
    const [existing] = await db
      .select()
      .from(songRequests)
      .where(eq(songRequests.id, id))
      .limit(1);

    if (!existing) {
      return null;
    }
    if (existing.status !== "queued") {
      return null;
    }

    const [row] = await db
      .update(songRequests)
      .set({
        status: "generating",
        generationAttempts: existing.generationAttempts + 1,
        startedAt: new Date(),
        errorCode: null,
        errorMessage: null,
        promptSuggestion: null,
      })
      .where(and(eq(songRequests.id, id), eq(songRequests.status, "queued")))
      .returning();

    if (!row) {
      return null;
    }
    await recordEvent(id, "generation_started", {
      attempt: existing.generationAttempts + 1,
    });
    return toRecord(row);
  });
}


export async function markRequestReady(
  id: string,
  audioUrl: string,
  blobPath: string,
  songId: string | null,
  lyrics: Lyrics | null = null,
  meta: {
    title?: string | null;
    isExplicit?: boolean;
    songMetadata?: Record<string, unknown>;
  } = {}
) {
  await dbCall(async () => {
    await db
      .update(songRequests)
      .set({
        status: "ready",
        audioUrl,
        blobPath,
        songId,
        lyrics,
        title: meta.title ?? null,
        isExplicit: meta.isExplicit ?? false,
        ...(meta.songMetadata ? { metadata: meta.songMetadata } : {}),
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      })
      .where(eq(songRequests.id, id));

    await recordEvent(id, "generation_completed", {
      audioUrl,
      songId,
      title: meta.title ?? null,
    });
  });
}


export async function markRequestFailed(
  id: string,
  code: string,
  message: string,
  suggestion?: string
) {
  await dbCall(async () => {
    const status: RequestStatus = code === "bad_prompt" ? "rejected" : "failed";
    await db
      .update(songRequests)
      .set({
        status,
        errorCode: code,
        errorMessage: message,
        promptSuggestion: suggestion ?? null,
        completedAt: new Date(),
      })
      .where(eq(songRequests.id, id));

    await recordEvent(
      id,
      status === "rejected" ? "request_rejected" : "generation_failed",
      { code, message, suggestion }
    );
  });
}
