// AutoDJ — the house filling its own queue so a room never runs dry. Local
// hosts type a brief in the console; Lovable sends one per agenda item
// ("warm arrival house for a rooftop reception"). When there's no brief we
// fall back to ad-lib variation so the room still sounds deliberate.
//
// `buildAutoDjPrompt` is pure (no I/O) so it's trivially testable, and it
// varies every call — that's what keeps a long block from looping the same
// four songs. Unlike station IDs these are ordinary queue tracks, so the
// prompt reads like something a thoughtful host would have requested.

/** Ready tracks AutoDJ tries to keep ahead of the room. */
export const AUTODJ_DEFAULT_TARGET = 2;

/** Never start more than this in one pass, however deep the shortfall. */
export const AUTODJ_MAX_PER_PASS = 2;

/**
 * Stop topping up this close to the end of an agenda block — a track started
 * later than this would outlive the room it was generated for.
 */
export const AUTODJ_WINDDOWN_MS = 5 * 60 * 1000;

/** Credited on the stage and in the files list so house tracks are obvious. */
export const AUTODJ_CREDIT = "AutoDJ";

// Variation pools, only used when no brief is set. Add freely — every entry
// widens the ad-lib space.
const VIBES = [
  "warm and welcoming",
  "easy mid-tempo",
  "bright and optimistic",
  "smooth late-night",
  "understated and spacious",
  "quietly energetic",
];

const STYLES = [
  "deep house with a soft rolling bassline",
  "downtempo electronica with warm pads",
  "nu-disco with muted guitar and light percussion",
  "lo-fi soul with dusty keys",
  "melodic techno that stays in the background",
  "organic house with hand percussion",
];

const TEXTURES = [
  "analog warmth and gentle tape saturation",
  "airy reverb and a wide stereo image",
  "crisp drums and a clean low end",
  "soft Rhodes chords and brushed hats",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Briefs are typed by hand, so they rarely end in punctuation. */
function asSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Rough time-of-day read used to shape the room's energy. */
function partOfDay(at: Date): string {
  const hour = at.getHours();
  if (hour < 11) return "morning";
  if (hour < 15) return "midday";
  if (hour < 18) return "late afternoon";
  if (hour < 22) return "evening";
  return "late night";
}

export type AutoDjContext = {
  /** Vibe instruction from Lovable's agenda item, or typed by the host. */
  brief?: string | null;
  /** Agenda item title, e.g. "Opening Reception". */
  sessionName?: string | null;
  /** Physical space, e.g. "Main Hall". */
  roomName?: string | null;
  /** Defaults to now; injectable for tests. */
  now?: Date;
};

/**
 * Build a fresh prompt for a house track. A brief leads when present — it's the
 * most specific thing anyone has told us about this room — with the agenda
 * context behind it. Everything falls back to ad-libs so an empty brief still
 * produces something varied rather than silence.
 */
export function buildAutoDjPrompt(context: AutoDjContext = {}): string {
  const brief = context.brief?.trim();
  const room = context.roomName?.trim();
  const session = context.sessionName?.trim();
  const when = partOfDay(context.now ?? new Date());

  const lines: string[] = [];

  if (brief) {
    lines.push(asSentence(brief));
  } else {
    lines.push(
      `A ${pick(VIBES)} instrumental track: ${pick(STYLES)}, with ${pick(TEXTURES)}.`
    );
  }

  const setting = [session, room].filter(Boolean).join(" in ");
  if (setting) {
    lines.push(`It plays in the background at ${setting} (${when}).`);
  } else {
    lines.push(`It plays in the background (${when}).`);
  }

  lines.push(
    "Keep it steady and conversation-friendly — no abrupt drops or long silences.",
    "Write original music — do not imitate named artists or copyrighted songs."
  );

  return lines.join(" ");
}
