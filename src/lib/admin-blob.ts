import "server-only";

import { del, list } from "@vercel/blob";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { sessions, songRequests, users } from "@/lib/db/schema";

/**
 * Admin-only Vercel Blob management. Song audio lives at `tracks/{requestId}.mp3`
 * (public, deterministic pathname — see lib/generation). We scope every
 * operation to this prefix so the panel can never touch unrelated blobs.
 *
 * A blob is "referenced" when its request id still has a row whose audio_url is
 * set. requeueRequest() nulls those fields without deleting the blob, and a
 * failed del() leaves a file behind, so unreferenced ("orphan") blobs accrue —
 * this module surfaces and reaps them. Callers MUST be requireAdmin()-gated.
 */

const TRACK_PREFIX = "tracks/";
const PAGE_SIZE = 100;
// Safety cap for the full-store scans (stats / cleanup): 200 pages × 100 ≈ 20k
// blobs. Far above the app's realistic footprint; guards against a runaway loop.
const MAX_SCAN_PAGES = 200;

export type BlobEntry = {
  pathname: string;
  url: string;
  size: number;
  uploadedAt: string;
  referenced: boolean;
  requestId: string | null;
  title: string | null;
  status: string | null;
  sessionName: string | null;
  hostEmail: string | null;
};

export type BlobPage = {
  entries: BlobEntry[];
  cursor: string | null;
  hasMore: boolean;
};

export type BlobStats = {
  totalCount: number;
  totalSize: number;
  referencedCount: number;
  orphanCount: number;
  orphanSize: number;
  truncated: boolean;
};

/** `tracks/3c79ce3f-…-mp3` → `3c79ce3f-…`. Null for anything off-pattern. */
function requestIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(TRACK_PREFIX) || !pathname.endsWith(".mp3")) {
    return null;
  }
  const id = pathname.slice(TRACK_PREFIX.length, -".mp3".length);
  return id.length > 0 ? id : null;
}

/** True only for app-owned audio blobs. The single guard before any del(). */
export function isTrackPath(pathname: string): boolean {
  return requestIdFromPath(pathname) !== null;
}

type RequestMeta = {
  audioUrl: string | null;
  title: string | null;
  status: string;
  sessionName: string | null;
  hostEmail: string | null;
};

/** Look up DB metadata for a set of request ids (for reference + attribution). */
async function requestMetaByIds(
  ids: string[]
): Promise<Map<string, RequestMeta>> {
  const map = new Map<string, RequestMeta>();
  if (ids.length === 0) {
    return map;
  }
  const rows = await db
    .select({
      id: songRequests.id,
      audioUrl: songRequests.audioUrl,
      title: songRequests.title,
      status: songRequests.status,
      sessionName: sessions.name,
      hostEmail: users.email,
    })
    .from(songRequests)
    .leftJoin(sessions, eq(songRequests.sessionId, sessions.id))
    .leftJoin(users, eq(sessions.hostId, users.id))
    .where(inArray(songRequests.id, ids));

  for (const row of rows) {
    map.set(row.id, {
      audioUrl: row.audioUrl,
      title: row.title,
      status: row.status,
      sessionName: row.sessionName,
      hostEmail: row.hostEmail,
    });
  }
  return map;
}

/** A blob is referenced when its request row still points audio_url at it. */
function isReferenced(meta: RequestMeta | undefined): boolean {
  return Boolean(meta && meta.audioUrl);
}

/** One page of track blobs, enriched with DB reference + attribution. */
export async function listBlobsPage(cursor?: string): Promise<BlobPage> {
  const result = await list({
    prefix: TRACK_PREFIX,
    limit: PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
  });

  const ids = result.blobs
    .map((blob) => requestIdFromPath(blob.pathname))
    .filter((id): id is string => id !== null);
  const meta = await requestMetaByIds(ids);

  const entries: BlobEntry[] = result.blobs.map((blob) => {
    const requestId = requestIdFromPath(blob.pathname);
    const row = requestId ? meta.get(requestId) : undefined;
    return {
      pathname: blob.pathname,
      url: blob.url,
      size: blob.size,
      uploadedAt:
        blob.uploadedAt instanceof Date
          ? blob.uploadedAt.toISOString()
          : String(blob.uploadedAt),
      referenced: isReferenced(row),
      requestId,
      title: row?.title ?? null,
      status: row?.status ?? null,
      sessionName: row?.sessionName ?? null,
      hostEmail: row?.hostEmail ?? null,
    };
  });

  return {
    entries,
    cursor: result.cursor ?? null,
    hasMore: result.hasMore,
  };
}

/** Walk the whole tracks/ prefix, yielding each page (bounded by MAX_SCAN_PAGES). */
async function scanAll(): Promise<{
  blobs: { pathname: string; url: string; size: number }[];
  truncated: boolean;
}> {
  const blobs: { pathname: string; url: string; size: number }[] = [];
  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;

  do {
    const result = await list({
      prefix: TRACK_PREFIX,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    for (const blob of result.blobs) {
      blobs.push({
        pathname: blob.pathname,
        url: blob.url,
        size: blob.size,
      });
    }
    cursor = result.hasMore ? result.cursor : undefined;
    pages += 1;
    if (pages >= MAX_SCAN_PAGES && cursor) {
      truncated = true;
      break;
    }
  } while (cursor);

  return { blobs, truncated };
}

/** Which of these request ids are referenced (have audio_url set). */
async function referencedIds(ids: string[]): Promise<Set<string>> {
  const meta = await requestMetaByIds(ids);
  const set = new Set<string>();
  for (const [id, row] of meta) {
    if (isReferenced(row)) {
      set.add(id);
    }
  }
  return set;
}

/** Store-wide totals + orphan breakdown. */
export async function getBlobStats(): Promise<BlobStats> {
  const { blobs, truncated } = await scanAll();
  const ids = blobs
    .map((blob) => requestIdFromPath(blob.pathname))
    .filter((id): id is string => id !== null);
  const referenced = await referencedIds(ids);

  let totalSize = 0;
  let orphanCount = 0;
  let orphanSize = 0;
  for (const blob of blobs) {
    totalSize += blob.size;
    const id = requestIdFromPath(blob.pathname);
    if (!id || !referenced.has(id)) {
      orphanCount += 1;
      orphanSize += blob.size;
    }
  }

  return {
    totalCount: blobs.length,
    totalSize,
    referencedCount: blobs.length - orphanCount,
    orphanCount,
    orphanSize,
    truncated,
  };
}

/** Delete every unreferenced track blob. Returns count + bytes reclaimed. */
export async function cleanupOrphanBlobs(): Promise<{
  deleted: number;
  freedBytes: number;
}> {
  const { blobs } = await scanAll();
  const ids = blobs
    .map((blob) => requestIdFromPath(blob.pathname))
    .filter((id): id is string => id !== null);
  const referenced = await referencedIds(ids);

  const orphans = blobs.filter((blob) => {
    const id = requestIdFromPath(blob.pathname);
    return !id || !referenced.has(id);
  });
  if (orphans.length === 0) {
    return { deleted: 0, freedBytes: 0 };
  }

  const freedBytes = orphans.reduce((sum, blob) => sum + blob.size, 0);
  // del() accepts up to 1000 urls per call; chunk to stay within that.
  for (let i = 0; i < orphans.length; i += 1000) {
    await del(orphans.slice(i, i + 1000).map((blob) => blob.pathname));
  }
  return { deleted: orphans.length, freedBytes };
}

/**
 * Delete a single track blob. If a request row still references it, clear the
 * audio fields and archive the row so the app never renders a dead link.
 * Throws on a non-track pathname (the caller also guards, defence in depth).
 */
export async function deleteBlob(pathname: string): Promise<{ ok: true }> {
  const requestId = requestIdFromPath(pathname);
  if (!requestId) {
    throw new Error("Refusing to delete a blob outside the tracks/ namespace.");
  }

  await del(pathname);

  await db
    .update(songRequests)
    .set({ audioUrl: null, blobPath: null, status: "archived", position: null })
    .where(eq(songRequests.id, requestId));

  return { ok: true };
}
