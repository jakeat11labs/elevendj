import "server-only";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/lib/db/client";
import { playerDevices } from "@/lib/db/schema";
import type { PlayerDeviceRow } from "@/lib/db/schema";
import {
  PLAYER_COOKIE_NAME,
  playerPrefixFromSecret,
  verifyCredential,
} from "@/lib/auth/credentials";
import { AppError } from "@/lib/errors";

export type AuthenticatedPlayer = {
  id: string;
  name: string;
  sessionId: string | null;
  status: string;
  audioUnlocked: boolean;
};

function mapDevice(row: PlayerDeviceRow): AuthenticatedPlayer {
  return {
    id: row.id,
    name: row.name,
    sessionId: row.sessionId,
    status: row.status,
    audioUnlocked: row.audioUnlocked,
  };
}

export async function requirePlayerDevice(): Promise<AuthenticatedPlayer> {
  const jar = await cookies();
  const secret = jar.get(PLAYER_COOKIE_NAME)?.value;
  if (!secret) {
    throw new AppError(401, "unauthorized", "Player is not paired.");
  }

  const prefix = playerPrefixFromSecret(secret);
  if (!prefix) {
    throw new AppError(401, "unauthorized", "Invalid player credential.");
  }

  const [row] = await db
    .select()
    .from(playerDevices)
    .where(
      and(
        eq(playerDevices.credentialPrefix, prefix),
        eq(playerDevices.status, "active")
      )
    )
    .limit(1);

  if (!row || !verifyCredential(secret, row.credentialHash)) {
    throw new AppError(401, "unauthorized", "Invalid player credential.");
  }

  return mapDevice(row);
}

export function playerCookieOptions(secret: string) {
  return {
    name: PLAYER_COOKIE_NAME,
    value: secret,
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  };
}

export function clearPlayerCookieOptions() {
  return {
    name: PLAYER_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: 0,
  };
}
