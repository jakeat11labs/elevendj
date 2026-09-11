import "server-only";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";

import {
  ROOM_OPERATOR_COOKIE_MAX_AGE,
  ROOM_OPERATOR_COOKIE_NAME,
} from "@/lib/auth/credentials";
import { getCurrentUser } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  hasOperatorGrant,
  listOperatorRoomIds,
  verifyRoomOperatorSession,
} from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";

export type RoomOperatorPrincipal = {
  kind: "admin" | "operator" | "emergency";
  actorId: string;
  displayName: string;
  sessionId: string | null;
};

/** Lax auth cookies require an explicit origin check on every mutation. */
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new AppError(
      403,
      "invalid_origin",
      "Room control requests must come from this site."
    );
  }
}

async function emergencyPrincipal(): Promise<RoomOperatorPrincipal | null> {
  const jar = await cookies();
  const secret = jar.get(ROOM_OPERATOR_COOKIE_NAME)?.value;
  if (!secret) return null;
  const session = await verifyRoomOperatorSession(secret);
  if (!session) return null;
  return {
    kind: "emergency",
    actorId: session.sessionCredentialId,
    displayName: "Room operator",
    sessionId: session.sessionId,
  };
}

/**
 * Resolve what rooms the current browser may list. Admins see all, signed-in
 * operators see their explicit grants, and emergency sessions see one room.
 */
export async function getRoomOperatorScope(): Promise<
  | {
      principal: RoomOperatorPrincipal;
      allRooms: boolean;
      roomIds: string[];
    }
  | null
> {
  try {
    const user = await getCurrentUser();
    if (user?.isAdmin) {
      return {
        principal: {
          kind: "admin",
          actorId: user.id,
          displayName: user.displayName || user.email,
          sessionId: null,
        },
        allRooms: true,
        roomIds: [],
      };
    }
    if (user) {
      const roomIds = await listOperatorRoomIds(user.id);
      if (roomIds.length > 0) {
        return {
          principal: {
            kind: "operator",
            actorId: user.id,
            displayName: user.displayName || user.email,
            sessionId: null,
          },
          allRooms: false,
          roomIds,
        };
      }
    }
  } catch {
    // No usable member session; try the emergency cookie.
  }

  const principal = await emergencyPrincipal();
  return principal
    ? {
        principal,
        allRooms: false,
        roomIds: [principal.sessionId!],
      }
    : null;
}

export async function requireRoomOperatorScope() {
  const scope = await getRoomOperatorScope();
  if (!scope) {
    throw new AppError(
      401,
      "operator_unauthorized",
      "Sign in with a room assignment or use a valid emergency link and PIN."
    );
  }
  return scope;
}

/**
 * Authenticate and authorize in one room-bound operation. A signed-in user
 * without a grant receives 404, so room IDs cannot be probed.
 */
export async function requireRoomOperatorAccess(
  sessionId: string
): Promise<RoomOperatorPrincipal> {
  const [room] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(eq(sessions.id, sessionId), eq(sessions.source, "integration"))
    )
    .limit(1);
  if (!room) {
    throw new AppError(404, "session_not_found", "Offsite room not found.");
  }

  try {
    const user = await getCurrentUser();
    if (user?.isAdmin) {
      return {
        kind: "admin",
        actorId: user.id,
        displayName: user.displayName || user.email,
        sessionId,
      };
    }
    if (user && (await hasOperatorGrant(user.id, sessionId))) {
      return {
        kind: "operator",
        actorId: user.id,
        displayName: user.displayName || user.email,
        sessionId,
      };
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
  }

  const emergency = await emergencyPrincipal();
  if (!emergency || emergency.sessionId !== sessionId) {
    throw new AppError(404, "session_not_found", "Offsite room not found.");
  }
  return emergency;
}

export function roomOperatorCookie(secret: string, maxAgeSeconds?: number) {
  return {
    name: ROOM_OPERATOR_COOKIE_NAME,
    value: secret,
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    maxAge: Math.min(
      maxAgeSeconds ?? ROOM_OPERATOR_COOKIE_MAX_AGE,
      ROOM_OPERATOR_COOKIE_MAX_AGE
    ),
  };
}

export function clearRoomOperatorCookie() {
  return {
    ...roomOperatorCookie("", 0),
    maxAge: 0,
  };
}
