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
  // "song" for audience requests; "station_id" for the AI radio-ID jingles that
  // placeStationIds() interleaves into the queue. Virtual station-ID entries are
  // not real DB rows.
  kind: "song" | "station_id";
  // For interleaved station IDs only: the real pool row id this virtual entry
  // was drawn from, so the stage can archive the right row when it finishes.
  stationSourceId?: string;
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

export type StationIdPlacement = {
  enabled: boolean;
  isPlaying: boolean;
  currentId: string | null;
  cadence: number;
};

// Interleave virtual station-ID entries into the real-song queue so the list the
// host sees and the order the stage plays are derived from ONE computation. Pure
// (no I/O): same inputs → same output.
//
// Cadence is anchored to ABSOLUTE song index (a station ID after every `cadence`
// songs), NOT to the moving "now playing" pointer. A cadence keyed off the
// current track recedes one slot every time playback advances — the boundary
// stays two songs ahead forever and never actually fires. On top of that fixed
// cadence:
//   - stopped → a single "lead" ID sits just before the current track (the very
//     top when nothing has played yet) so a jingle opens the set.
//   - playing → no lead (we never cut off the current song); the next cadence ID
//     is already sitting in the upcoming list.
//
// Virtual entries are drawn round-robin from `pool` (the warm jingles), tagged
// kind:"station_id", and carry `stationSourceId` (the real pool row id). They
// never carry a real queue `position` and are excluded from counts/limits by the
// caller (they're added after counting).
export function placeStationIds(
  songs: QueueItem[],
  pool: QueueItem[],
  { enabled, isPlaying, currentId, cadence }: StationIdPlacement
): QueueItem[] {
  if (!enabled || pool.length === 0) {
    return songs;
  }

  let slot = 0;
  const nextStationId = (): QueueItem => {
    const source = pool[slot % pool.length];
    slot += 1;
    return {
      ...source,
      id: `sid:${source.id}:${slot}`,
      kind: "station_id",
      stationSourceId: source.id,
      position: null,
      title: source.title ?? "Radio ID",
    };
  };

  // Where the stopped "lead" jingle goes: immediately before the current track,
  // or the very top when nothing is current. -1 = no lead (playing).
  const leadIndex = isPlaying
    ? -1
    : currentId
      ? Math.max(0, songs.findIndex((s) => s.id === currentId))
      : 0;

  if (songs.length === 0) {
    return leadIndex >= 0 ? [nextStationId()] : [];
  }

  const step = Math.max(1, cadence);
  const out: QueueItem[] = [];
  songs.forEach((song, index) => {
    if (index === leadIndex) {
      out.push(nextStationId());
    }
    out.push(song);
    if ((index + 1) % step === 0) {
      out.push(nextStationId());
    }
  });
  return out;
}

export type QueueSnapshot = {
  topic: string;
  requestsOpen: boolean;
  /** Requests queue without host approval. */
  autoApprove: boolean;
  /** The room tops up its own queue when it runs dry. */
  autoDjEnabled: boolean;
  defaultDurationMs: number;
  forceInstrumental: boolean;
  // Selected orb gradient colorway name (see src/components/orb/colorways.ts).
  orbColorway: string;
  // Host-controlled room master volume (0..1). The stage screen obeys this.
  masterVolume: number;
  // Station ID: when on, the server interleaves short AI "radio ID" jingles into
  // `items` at computed slots (see placeStationIds) — one lead-off when stopped,
  // then one after every couple of songs. `stationIds` is the raw warm pool the
  // jingles are drawn from; pool entries never count toward queue limits, and
  // interleaved entries (kind:"station_id") are added after counts are tallied.
  stationIdEnabled: boolean;
  stationIds: QueueItem[];
  // Crossfade: when on, the stage overlaps the end of each track with the start
  // of the next (radio-style) instead of hard-cutting.
  crossfadeEnabled: boolean;
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
  autoApprove: boolean;
  track: {
    id: string;
    prompt: string;
    requesterName: string | null;
    status: RequestStatus;
  } | null;
};

export const REALTIME_TOPIC =
  process.env.NEXT_PUBLIC_REALTIME_TOPIC || "playlist:main";
