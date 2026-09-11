import "server-only";

import { createHash, randomBytes } from "crypto";
import { z } from "zod";

import { optionalEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { resolveMusicStyle } from "@/lib/music-styles";

export const requestSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(10, "Give the DJ at least a phrase to work with.")
    .max(800, "Keep requests under 800 characters."),
  requesterName: z
    .string()
    .trim()
    .min(1, "Add your name so the DJ knows who to thank.")
    .max(40, "Names must be 40 characters or fewer."),
  styleId: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .optional()
    .refine(
      (value) => !value || Boolean(resolveMusicStyle(value)),
      "Choose a supported music style."
    )
    .default(null),
  instrumental: z.boolean().optional().default(false),
});

export type RequestInput = z.infer<typeof requestSchema>;

const unsafePromptPatterns = [
  /\b(?:copyrighted\s+lyrics|exact\s+lyrics|copy\s+the\s+lyrics|lyrics\s+from)\b/i,
  /\b(?:sounds?\s+like|in\s+the\s+style\s+of|as\s+if\s+by|make\s+it\s+like)\s+["']?[A-Z][\w .'-]{2,}/,
  /\b(?:cover|remake|clone)\s+(?:of\s+)?["']?[A-Z][\w .'-]{2,}/,
  /\b(?:self[-\s]?harm|kill\s+yourself|racial\s+slur|terrorist\s+anthem)\b/i,
];

const commonCopyrightedExamples = [
  "bohemian rhapsody",
  "hotel california",
  "thriller",
  "taylor swift",
  "drake",
  "beyonce",
  "beatles",
  "radiohead",
  "kendrick lamar",
];

export function parseRequestBody(body: unknown) {
  const result = requestSchema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AppError(400, "invalid_request", issue?.message ?? "Invalid request.");
  }
  return result.data;
}

/**
 * Requester avatars come from a trusted integration, but they end up in an
 * `<img>` on a screen in front of a room, so re-validate rather than trust:
 * https only (no `data:`/`javascript:`), and a sane length.
 */
export function sanitizeAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) return null;
  try {
    return new URL(trimmed).protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

export function normalizePrompt(prompt: string) {
  return prompt
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function assertPromptAllowed(prompt: string) {
  const normalized = normalizePrompt(prompt);
  const blockedExample = commonCopyrightedExamples.find((example) =>
    normalized.includes(example)
  );

  if (blockedExample || unsafePromptPatterns.some((pattern) => pattern.test(prompt))) {
    throw new AppError(
      422,
      "prompt_not_allowed",
      "This request is too close to a protected artist, song, lyric, or unsafe theme.",
      "Describe the mood, instruments, tempo, and setting without naming artists, songs, or lyrics."
    );
  }
}

export function buildGenerationPrompt(
  prompt: string,
  instrumental = false,
  styleId?: string | null
) {
  const style = resolveMusicStyle(styleId);
  const styleDirection = style
    ? `Style direction: ${style.direction}.`
    : null;
  if (instrumental) {
    return [
      "Create an original instrumental DJ-request track.",
      "Do not imitate named artists, bands, songs, melodies, or copyrighted lyrics.",
      "Avoid vocals unless the prompt explicitly asks for abstract vocal texture.",
      styleDirection,
      `Audience request: ${prompt}`,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    "Create an original DJ-request song with sung vocals and original lyrics.",
    "Do not imitate named artists, bands, songs, melodies, or copyrighted lyrics.",
    "Write fresh, fitting lyrics for the mood and scene described.",
    styleDirection,
    `Audience request: ${prompt}`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function generateClientToken() {
  return randomBytes(24).toString("base64url");
}

export function hashValue(value: string, purpose: string) {
  const salt =
    optionalEnv("REQUEST_HASH_SECRET") ||
    optionalEnv("NEON_AUTH_COOKIE_SECRET") ||
    "elevendj-local-development";

  return createHash("sha256")
    .update(`${purpose}:${salt}:${value}`)
    .digest("hex");
}

export function clientIpFromRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}
