import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "crypto";

import { requiredEnv } from "@/lib/env";

/**
 * Reversible secret storage for per-host ElevenLabs API keys.
 *
 * Unlike `hashValue` in security.ts (one-way SHA-256), these must round-trip:
 * we decrypt the stored ciphertext server-side to call ElevenLabs on the host's
 * behalf. AES-256-GCM gives confidentiality + tamper detection (auth tag).
 *
 * Wire format: `v1:<base64(iv | authTag | ciphertext)>`
 *   iv      = 12 bytes (GCM standard)
 *   authTag = 16 bytes
 *   ciphertext = remainder
 *
 * The master key comes from ELEVENLABS_KEY_SECRET (32 raw bytes, supplied as
 * base64 — generate with `openssl rand -base64 32`). Read lazily so the app
 * only requires it when the API-key feature is actually exercised.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = requiredEnv("ELEVENLABS_KEY_SECRET");
  // Accept base64 (preferred) or hex; must decode to exactly 32 bytes.
  let key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    const hex = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : null;
    if (hex && hex.length === 32) {
      key = hex;
    } else {
      throw new Error(
        "ELEVENLABS_KEY_SECRET must decode to 32 bytes (e.g. `openssl rand -base64 32`)."
      );
    }
  }
  cachedKey = key;
  return key;
}

/** Encrypt a plaintext secret into the versioned wire format. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, ciphertext]).toString("base64");
  return `${VERSION}:${payload}`;
}

/** Decrypt a value produced by `encryptSecret`. Throws on tamper/format/version mismatch. */
export function decryptSecret(value: string): string {
  const sep = value.indexOf(":");
  if (sep === -1) {
    throw new Error("Malformed encrypted secret.");
  }
  const version = value.slice(0, sep);
  // Constant-time version compare to avoid leaking which prefix matched.
  const vBuf = Buffer.from(version);
  const expected = Buffer.from(VERSION);
  if (vBuf.length !== expected.length || !timingSafeEqual(vBuf, expected)) {
    throw new Error("Unsupported encrypted secret version.");
  }

  const raw = Buffer.from(value.slice(sep + 1), "base64");
  if (raw.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("Malformed encrypted secret.");
  }
  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}
