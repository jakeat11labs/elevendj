import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "crypto";

import { optionalEnv, requiredEnv } from "@/lib/env";

const INTEGRATION_PREFIX = "edj_live_";
const PLAYER_PREFIX = "edj_player_";
const ROOM_OPERATOR_PREFIX = "edj_room_";
const ROOM_OPERATOR_SESSION_PREFIX = "edj_room_session_";

function pepper(): string {
  return (
    optionalEnv("AUTH_TOKEN_PEPPER") ||
    requiredEnv("NEON_AUTH_COOKIE_SECRET")
  );
}

/** HMAC-SHA-256 credential hash. Never store the raw secret. */
export function hashCredential(secret: string): string {
  return createHmac("sha256", pepper()).update(secret).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function verifyCredential(
  secret: string,
  expectedHash: string
): boolean {
  return safeEqualHex(hashCredential(secret), expectedHash);
}

function makeSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export type IssuedCredential = {
  /** Full bearer/cookie secret — shown once, never stored. */
  secret: string;
  hash: string;
  /** Short prefix for display/logs (not secret). */
  prefix: string;
};

/** Integration API key: `edj_live_<prefix>.<secret>` */
export function issueIntegrationCredential(): IssuedCredential {
  const prefix = randomBytes(4).toString("hex");
  const body = makeSecret(32);
  const secret = `${INTEGRATION_PREFIX}${prefix}.${body}`;
  return {
    secret,
    hash: hashCredential(secret),
    prefix,
  };
}

export function parseIntegrationBearer(
  header: string | null
): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match?.[1]) return null;
  const token = match[1].trim();
  if (!token.startsWith(INTEGRATION_PREFIX)) return null;
  return token;
}

export function integrationPrefixFromSecret(secret: string): string | null {
  if (!secret.startsWith(INTEGRATION_PREFIX)) return null;
  const rest = secret.slice(INTEGRATION_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return null;
  return rest.slice(0, dot);
}

/** Player device credential (stored in HttpOnly cookie). */
export function issuePlayerCredential(): IssuedCredential {
  const prefix = randomBytes(4).toString("hex");
  const body = makeSecret(32);
  const secret = `${PLAYER_PREFIX}${prefix}.${body}`;
  return {
    secret,
    hash: hashCredential(secret),
    prefix,
  };
}

export function playerPrefixFromSecret(secret: string): string | null {
  if (!secret.startsWith(PLAYER_PREFIX)) return null;
  const rest = secret.slice(PLAYER_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return null;
  return rest.slice(0, dot);
}

/** Room-scoped emergency controller credential. */
export function issueRoomOperatorCredential(): IssuedCredential {
  const prefix = randomBytes(4).toString("hex");
  const body = makeSecret(32);
  const secret = `${ROOM_OPERATOR_PREFIX}${prefix}.${body}`;
  return {
    secret,
    hash: hashCredential(secret),
    prefix,
  };
}

export function roomOperatorPrefixFromSecret(
  secret: string
): string | null {
  if (!secret.startsWith(ROOM_OPERATOR_PREFIX)) return null;
  const rest = secret.slice(ROOM_OPERATOR_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return null;
  return rest.slice(0, dot);
}

export function issueRoomOperatorPin(): string {
  return randomInt(0, 100_000_000).toString().padStart(8, "0");
}

export function issueRoomOperatorSessionCredential(): IssuedCredential {
  const prefix = randomBytes(4).toString("hex");
  const body = makeSecret(32);
  const secret = `${ROOM_OPERATOR_SESSION_PREFIX}${prefix}.${body}`;
  return {
    secret,
    hash: hashCredential(secret),
    prefix,
  };
}

export function roomOperatorSessionPrefixFromSecret(
  secret: string
): string | null {
  if (!secret.startsWith(ROOM_OPERATOR_SESSION_PREFIX)) return null;
  const rest = secret.slice(ROOM_OPERATOR_SESSION_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return null;
  return rest.slice(0, dot);
}

/** Short human-readable pairing code (e.g. AB7K2M). */
export function issuePairingDisplayCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export const PLAYER_COOKIE_NAME = "__Host-elevendj-player";
export const PLAYER_COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days
export const ROOM_OPERATOR_COOKIE_NAME = "__Host-elevendj-room-operator";
export const ROOM_OPERATOR_COOKIE_MAX_AGE = 60 * 60 * 8; // one event shift
