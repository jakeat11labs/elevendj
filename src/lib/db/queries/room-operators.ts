import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";

import {
  hashCredential,
  issueRoomOperatorCredential,
  issueRoomOperatorPin,
  issueRoomOperatorSessionCredential,
  roomOperatorSessionPrefixFromSecret,
  safeEqualHex,
  verifyCredential,
} from "@/lib/auth/credentials";
import { db } from "@/lib/db/client";
import {
  offsiteOperatorGrants,
  roomOperatorCredentials,
  roomOperatorSessions,
  sessions,
  users,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { dbCall, toIso } from "./internal";

const DUMMY_HASH = hashCredential("invalid-room-operator-credential");
const MAX_FAILURES = 5;

function pinHash(secretPrefix: string, pin: string): string {
  return hashCredential(`offsite-pin:${secretPrefix}:${pin}`);
}

function parseInviteToken(
  token: string
): { linkId: string; secret: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const linkId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      linkId
    ) ||
    !secret.startsWith("edj_room_")
  ) {
    return null;
  }
  return { linkId, secret };
}

export type RoomOperatorInvite = {
  sessionId: string;
  linkId: string;
  token: string;
  pin: string;
  expiresAt: string;
};

/** Rotate one room's emergency invitation; older invitations stop working. */
export async function issueRoomOperatorLink(input: {
  sessionId: string;
  createdBy: string;
  ttlHours?: number;
}): Promise<RoomOperatorInvite> {
  return dbCall(async () => {
    const [room] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, input.sessionId),
          eq(sessions.source, "integration")
        )
      )
      .limit(1);
    if (!room) {
      throw new AppError(
        404,
        "session_not_found",
        "Offsite room not found."
      );
    }

    const issued = issueRoomOperatorCredential();
    const pin = issueRoomOperatorPin();
    const candidateId = randomUUID();
    const expiresAt = new Date(
      Date.now() + Math.min(input.ttlHours ?? 12, 24) * 60 * 60 * 1000
    );
    const result = await db.execute<{ id: string }>(sql`
      with active_link as (
        select id
        from room_operator_credentials
        where session_id = ${input.sessionId}::uuid
          and revoked_at is null
      ),
      revoked_sessions as (
        update room_operator_sessions
        set revoked_at = now()
        where link_id in (select id from active_link)
          and revoked_at is null
        returning id
      ),
      revoke_barrier as (
        select count(*) from revoked_sessions
      )
      insert into room_operator_credentials (
        id, session_id, secret_hash, pin_hash, created_by, expires_at
      )
      select
        ${candidateId}::uuid,
        ${input.sessionId}::uuid,
        ${issued.hash},
        ${pinHash(issued.prefix, pin)},
        ${input.createdBy}::uuid,
        ${expiresAt}
      from revoke_barrier
      on conflict (session_id)
        where revoked_at is null
      do update set
        secret_hash = excluded.secret_hash,
        pin_hash = excluded.pin_hash,
        version = room_operator_credentials.version + 1,
        created_by = excluded.created_by,
        expires_at = excluded.expires_at,
        failed_attempt_count = 0,
        attempt_window_started_at = null,
        locked_until = null,
        last_failed_ip_hash = null,
        last_used_at = null
      returning id
    `);
    const linkId = result.rows[0]?.id;
    if (!linkId) {
      throw new AppError(
        503,
        "operator_link_failed",
        "Could not create the emergency room invitation."
      );
    }

    return {
      sessionId: input.sessionId,
      linkId,
      token: `${linkId}.${issued.secret}`,
      pin,
      expiresAt: expiresAt.toISOString(),
    };
  });
}

/**
 * Atomically reserve one attempt before checking either factor. Row locks
 * serialize parallel requests; the sixth attempt sees locked_until and gets no
 * row, so concurrency cannot bypass the five-attempt limit.
 */
async function reserveExchangeAttempt(
  linkId: string,
  ipHash: string,
  suppliedSecretHash: string
): Promise<{
  id: string;
  sessionId: string;
  secretHash: string;
  pinHash: string;
  version: number;
  expiresAt: Date;
} | null> {
  const result = await db.execute<{
    id: string;
    sessionId: string;
    secretHash: string;
    pinHash: string;
    version: number;
    expiresAt: string | Date;
  }>(sql`
    update room_operator_credentials
    set
      attempt_window_started_at = case
        when attempt_window_started_at is null
          or attempt_window_started_at < now() - interval '15 minutes'
        then now()
        else attempt_window_started_at
      end,
      failed_attempt_count = case
        when attempt_window_started_at is null
          or attempt_window_started_at < now() - interval '15 minutes'
        then 1
        else failed_attempt_count + 1
      end,
      locked_until = case
        when (
          case
            when attempt_window_started_at is null
              or attempt_window_started_at < now() - interval '15 minutes'
            then 1
            else failed_attempt_count + 1
          end
        ) >= ${MAX_FAILURES}
        then now() + interval '30 minutes'
        else locked_until
      end,
      last_failed_ip_hash = ${ipHash}
    where id = ${linkId}::uuid
      and secret_hash = ${suppliedSecretHash}
      and revoked_at is null
      and expires_at > now()
      and (locked_until is null or locked_until <= now())
    returning
      id,
      session_id as "sessionId",
      secret_hash as "secretHash",
      pin_hash as "pinHash",
      version,
      expires_at as "expiresAt"
  `);
  const row = result.rows[0];
  return row
    ? {
        ...row,
        expiresAt:
          row.expiresAt instanceof Date
            ? row.expiresAt
            : new Date(row.expiresAt),
      }
    : null;
}

/**
 * Verify both invitation factors and issue a fresh cookie credential. Every
 * failure has the same public result; nonexistent links still perform hashes.
 */
export async function exchangeRoomOperatorLink(input: {
  token: string;
  pin: string;
  ipHash: string;
  userAgentHash: string;
}): Promise<{
  sessionId: string;
  secret: string;
  expiresAt: Date;
} | null> {
  return dbCall(async () => {
    const parsed = parseInviteToken(input.token);
    const suppliedSecretHash = hashCredential(parsed?.secret ?? "invalid");
    const link = parsed
      ? await reserveExchangeAttempt(
          parsed.linkId,
          input.ipHash,
          suppliedSecretHash
        )
      : null;

    const secretValid = verifyCredential(
      parsed?.secret ?? "invalid",
      link?.secretHash ?? DUMMY_HASH
    );
    const secretPrefix = parsed
      ? parsed.secret.slice(
          "edj_room_".length,
          parsed.secret.indexOf(".")
        )
      : "invalid";
    const suppliedPinHash = pinHash(secretPrefix, input.pin);
    const pinValid = safeEqualHex(
      suppliedPinHash,
      link?.pinHash ?? DUMMY_HASH
    );
    const now = new Date();

    if (!link || !secretValid || !pinValid) {
      return null;
    }

    const issued = issueRoomOperatorSessionCredential();
    const expiresAt = new Date(
      Math.min(link.expiresAt.getTime(), Date.now() + 8 * 60 * 60 * 1000)
    );
    await db.insert(roomOperatorSessions).values({
      linkId: link.id,
      credentialHash: issued.hash,
      credentialPrefix: issued.prefix,
      linkVersion: link.version,
      expiresAt,
      ipHash: input.ipHash,
      userAgentHash: input.userAgentHash,
      lastSeenAt: now,
    });
    await db
      .update(roomOperatorCredentials)
      .set({
        lastUsedAt: now,
        failedAttemptCount: 0,
        attemptWindowStartedAt: null,
        lockedUntil: null,
      })
      .where(eq(roomOperatorCredentials.id, link.id));

    return { sessionId: link.sessionId, secret: issued.secret, expiresAt };
  });
}

export async function verifyRoomOperatorSession(
  secret: string
): Promise<{ sessionId: string; sessionCredentialId: string } | null> {
  return dbCall(async () => {
    const prefix = roomOperatorSessionPrefixFromSecret(secret);
    if (!prefix) return null;
    const now = new Date();
    const [row] = await db
      .select({
        id: roomOperatorSessions.id,
        sessionId: roomOperatorCredentials.sessionId,
        credentialHash: roomOperatorSessions.credentialHash,
        sessionLinkVersion: roomOperatorSessions.linkVersion,
        currentLinkVersion: roomOperatorCredentials.version,
      })
      .from(roomOperatorSessions)
      .innerJoin(
        roomOperatorCredentials,
        eq(roomOperatorCredentials.id, roomOperatorSessions.linkId)
      )
      .where(
        and(
          eq(roomOperatorSessions.credentialPrefix, prefix),
          isNull(roomOperatorSessions.revokedAt),
          gt(roomOperatorSessions.expiresAt, now),
          isNull(roomOperatorCredentials.revokedAt),
          gt(roomOperatorCredentials.expiresAt, now)
        )
      )
      .limit(1);
    if (
      !row ||
      row.sessionLinkVersion !== row.currentLinkVersion ||
      !verifyCredential(secret, row.credentialHash)
    ) {
      return null;
    }

    void db
      .update(roomOperatorSessions)
      .set({ lastSeenAt: now })
      .where(eq(roomOperatorSessions.id, row.id))
      .catch(() => undefined);
    return { sessionId: row.sessionId, sessionCredentialId: row.id };
  });
}

export async function revokeRoomOperatorLinks(
  sessionId: string
): Promise<void> {
  await dbCall(async () => {
    await db
      .update(roomOperatorCredentials)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(roomOperatorCredentials.sessionId, sessionId),
          isNull(roomOperatorCredentials.revokedAt)
        )
      );
  });
}

export async function listOperatorRoomIds(userId: string): Promise<string[]> {
  return dbCall(async () => {
    const now = new Date();
    const rows = await db
      .select({ sessionId: offsiteOperatorGrants.sessionId })
      .from(offsiteOperatorGrants)
      .where(
        and(
          eq(offsiteOperatorGrants.userId, userId),
          isNull(offsiteOperatorGrants.revokedAt),
          or(
            isNull(offsiteOperatorGrants.expiresAt),
            gt(offsiteOperatorGrants.expiresAt, now)
          )
        )
      );
    return rows.map((row) => row.sessionId);
  });
}

export async function hasOperatorGrant(
  userId: string,
  sessionId: string
): Promise<boolean> {
  return (await listOperatorRoomIds(userId)).includes(sessionId);
}

export async function listRoomOperatorGrants(sessionId: string) {
  return dbCall(async () => {
    const rows = await db
      .select({
        id: offsiteOperatorGrants.id,
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        expiresAt: offsiteOperatorGrants.expiresAt,
        revokedAt: offsiteOperatorGrants.revokedAt,
      })
      .from(offsiteOperatorGrants)
      .innerJoin(users, eq(users.id, offsiteOperatorGrants.userId))
      .where(eq(offsiteOperatorGrants.sessionId, sessionId));
    return rows.map((row) => ({
      ...row,
      expiresAt: toIso(row.expiresAt),
      revokedAt: toIso(row.revokedAt),
    }));
  });
}

export async function grantRoomOperator(input: {
  sessionId: string;
  userId: string;
  grantedBy: string;
  expiresAt?: Date | null;
}) {
  return dbCall(async () => {
    const [grant] = await db
      .insert(offsiteOperatorGrants)
      .values({
        sessionId: input.sessionId,
        userId: input.userId,
        grantedBy: input.grantedBy,
        expiresAt: input.expiresAt ?? null,
      })
      .onConflictDoUpdate({
        target: [
          offsiteOperatorGrants.userId,
          offsiteOperatorGrants.sessionId,
        ],
        set: {
          grantedBy: input.grantedBy,
          expiresAt: input.expiresAt ?? null,
          revokedAt: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return grant;
  });
}

export async function revokeRoomOperatorGrant(
  sessionId: string,
  userId: string
): Promise<void> {
  await dbCall(async () => {
    await db
      .update(offsiteOperatorGrants)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(offsiteOperatorGrants.sessionId, sessionId),
          eq(offsiteOperatorGrants.userId, userId)
        )
      );
  });
}
