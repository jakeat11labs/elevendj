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

// A single lyric line within a section. `type` is the model's tag
// (e.g. "vocal" | "instrumental"); we only render vocal/lyric lines.
export type LyricLine = {
  text: string;
  type?: string;
};

// One timed block of the song. `durationMs` lets the stage advance lyric
// blocks against audio playback time.
export type LyricSection = {
  name?: string;
  durationMs: number;
  lines: LyricLine[];
};

export type Lyrics = {
  sections: LyricSection[];
};

export type QueueItem = {
  id: string;
  requesterName: string | null;
  prompt: string;
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
  items: QueueItem[];
  counts: Record<RequestStatus, number>;
};

export type Session = {
  id: string;
  name: string;
  createdAt: string;
  isActive: boolean;
  trackCount?: number;
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
