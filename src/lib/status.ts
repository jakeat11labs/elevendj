export const REQUEST_STATUSES = [
  "pending",
  "queued",
  "generating",
  "ready",
  "rejected",
  "failed",
  "played",
  "archived",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

// A single word with its absolute timing, used for karaoke highlighting.
// `startMs`/`endMs` are absent for punctuation-only tokens, which inherit the
// highlight state of the preceding word when rendered.
export type LyricWord = {
  text: string;
  startMs?: number;
  endMs?: number;
};

// A single lyric line within a section. `type` is the model's tag
// (e.g. "vocal" | "instrumental"); we only render vocal/lyric lines.
// `startMs`/`endMs` are absolute offsets from the start of the song, present
// only when word-level timestamps were returned (see normalizeLyrics).
// `words` carries per-word timing for karaoke fill; absent on the durationMs
// fallback path, where `text` is rendered whole.
export type LyricLine = {
  text: string;
  type?: string;
  startMs?: number;
  endMs?: number;
  words?: LyricWord[];
};

// One timed block of the song. `durationMs` lets the stage advance lyric
// blocks against audio playback time. `startMs` is the absolute offset of the
// section, present only when word-level timestamps were available; the stage
// prefers it over cumulative `durationMs` when set.
export type LyricSection = {
  name?: string;
  durationMs: number;
  startMs?: number;
  lines: LyricLine[];
};

export type Lyrics = {
  sections: LyricSection[];
};

export type QueueItem = {
  id: string;
  requesterName: string | null;
  prompt: string;
  title: string | null;
  isExplicit: boolean;
  status: RequestStatus;
  position: number | null;
  durationMs: number;
  audioUrl: string | null;
  promptSuggestion: string | null;
  errorMessage: string | null;
  lyrics: Lyrics | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type QueueSnapshot = {
  topic: string;
  requestsOpen: boolean;
  autoDj: boolean;
  defaultDurationMs: number;
  forceInstrumental: boolean;
  // Selected orb gradient colorway name (see src/components/orb/colorways.ts).
  orbColorway: string;
  items: QueueItem[];
  counts: Record<RequestStatus, number>;
};

export type Session = {
  id: string;
  name: string;
  createdAt: string;
  isActive: boolean;
  trackCount?: number;
  // Present on host-scoped session payloads — the unguessable slug behind the
  // session's public request link/QR.
  publicCode?: string;
};

export type NowPlaying = {
  isPlaying: boolean;
  requestsOpen: boolean;
  autoDj: boolean;
  track: {
    id: string;
    prompt: string;
    requesterName: string | null;
    status: RequestStatus;
  } | null;
};

export const REALTIME_TOPIC =
  process.env.NEXT_PUBLIC_REALTIME_TOPIC || "playlist:main";
