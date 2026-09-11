// Station ID — the short AI-generated "radio ID" jingle the stage drops in
// after every couple of songs when a host enables the feature. This module is
// the single source of truth for the brand line, the prompt "ad-lib" variation,
// and the fixed shape of an ID (duration, cadence, warm-pool size).
//
// `buildStationIdPrompt` is a pure function (no I/O) so it's trivially testable
// and produces a slightly different prompt every call — that's what keeps the
// jingles feeling fresh. It intentionally does NOT route through
// `buildGenerationPrompt` in security.ts, which frames the text as an audience
// song request ("Audience request: ...") — a station ID is its own thing.

/** Consistent high-level brand line used when the host hasn't personalized. */
export const STATION_ID_BRAND = "ElevenDJ Radio, powered by ElevenLabs";

/** Real songs between station IDs. */
export const STATION_ID_CADENCE = 2;

/** Fixed broadcast-jingle length. Music v2/v2.5 support shorter clips; 10s is intentional. */
export const STATION_ID_DURATION_MS = 10_000;

/** How many ready IDs we keep warm so one can play instantly. */
export const STATION_ID_POOL_TARGET = 3;

// Variation pools. Add freely — every entry just widens the ad-lib space.
const VIBES = [
  "high-energy",
  "smooth late-night",
  "anthemic arena",
  "retro FM-radio",
  "festival main-stage",
  "underground club",
];

const BEDS = [
  "a punchy synthwave riser",
  "a crisp hip-hop stinger",
  "a euphoric EDM drop",
  "a triumphant orchestral fanfare",
  "a deep house groove",
  "a glitchy electro sweep",
];

const VOICES = [
  "a booming radio announcer",
  "a confident hype DJ",
  "a sultry late-night host",
  "an excited crowd chant",
  "a smooth soulful singer",
];

// Brand-line phrasings used when the host hasn't personalized the ID.
const TAGLINES = [
  STATION_ID_BRAND,
  `You're locked into ${STATION_ID_BRAND}`,
  `This is ${STATION_ID_BRAND}`,
  `Turn it up — ${STATION_ID_BRAND}`,
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Build a fresh, varied prompt for a ~10s vocal station ID. When `hostName` is
 * provided (host opted into personalization and typed a name) it's woven into
 * the spoken tagline; otherwise we fall back to a varied brand phrasing so the
 * high-level brand stays consistent.
 */
export function buildStationIdPrompt(hostName?: string | null): string {
  const trimmed = hostName?.trim();
  const tagline = trimmed
    ? `${trimmed} on ${STATION_ID_BRAND}`
    : pick(TAGLINES);

  return [
    `Create a ${pick(VIBES)} 10-second radio station ID — a short broadcast jingle, not a full song.`,
    `${pick(VOICES)} clearly says: "${tagline}".`,
    `Back the voice with ${pick(BEDS)}.`,
    "Keep it punchy and broadcast-ready. Write original audio — do not imitate real radio stations, named artists, or copyrighted music.",
  ].join(" ");
}
