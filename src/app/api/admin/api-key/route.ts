import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import { json, route } from "@/lib/api";
import { clearElevenLabsKey, setElevenLabsKey } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ElevenLabs keys are prefixed `sk_`. Keep the format check loose (length +
// prefix); the authoritative validation is the live API call below.
const bodySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20, "That doesn't look like a full API key.")
    .max(200, "That doesn't look like an API key.")
    .startsWith("sk_", "ElevenLabs keys start with “sk_”."),
});

/** Masked display value — last 4 chars, e.g. ••••3f9a. Never the full key. */
function maskKey(apiKey: string): string {
  return `••••${apiKey.slice(-4)}`;
}

/** Confirm the key works by making one lightweight authenticated GET. */
async function validateKey(apiKey: string): Promise<void> {
  try {
    const client = new ElevenLabsClient({ apiKey });
    await client.user.get();
  } catch {
    throw new AppError(
      400,
      "invalid_api_key",
      "ElevenLabs rejected that key. Double-check you copied the whole key and that it's active.",
      "Generate a fresh key at elevenlabs.io and paste it again."
    );
  }
}

export const POST = route(async (request: Request) => {
  const user = await requireHost();

  // Inline parse: surfaces the specific zod issue message (not a generic one).
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError(
      400,
      "invalid_request",
      issue?.message ?? "Invalid API key."
    );
  }

  const apiKey = parsed.data.apiKey;
  await validateKey(apiKey);

  const hint = maskKey(apiKey);
  await setElevenLabsKey(user.id, encryptSecret(apiKey), hint);

  return json({ ok: true, hint, addedAt: new Date().toISOString() });
});

export const DELETE = route(async () => {
  const user = await requireHost();
  await clearElevenLabsKey(user.id);
  return json({ ok: true });
});
