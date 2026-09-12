// Curated Offsite station IDs — the approved Cancún 2026 stingers.
//
// These are fixed, pre-rendered assets rather than per-session generations:
// every room's player pulls from this one shared list, so the sound of the
// Offsite is identical everywhere and costs no generation credits at showtime.
// Regenerate with scripts/stinger-batch-v1.mjs; this file is emitted from the
// verified metadata, so do not hand-edit the entries.
//
// Each clip was Scribe-verified to say "Offsite", "2026", and to end on
// "… powered by Eleven Music."

export type OffsiteStationId = {
  id: string;
  line: string;
  url: string;
  durationMs: number;
};

/** Real songs between station IDs. */
export const OFFSITE_STATION_ID_CADENCE = 2;

export const OFFSITE_STATION_IDS: readonly OffsiteStationId[] = [
  { id: "C2-01", line: "This is the Cancún Offsite 2026. Good vibes powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/c2-01.mp3", durationMs: 9000 },
  { id: "C2-02", line: "Welcome to the Cancún Offsite 2026. Island jams powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/c2-02.mp3", durationMs: 9000 },
  { id: "C2-03", line: "You're at the Cancún Offsite 2026. Every tune powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/c2-03.mp3", durationMs: 9000 },
  { id: "C2-04", line: "Sessions and sunsets. Offsite 2026. The soundtrack powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/c2-04.mp3", durationMs: 9000 },
  { id: "C2-05", line: "All week long at the Cancún Offsite 2026. Good vibes powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/c2-05.mp3", durationMs: 9000 },
  { id: "C2-06", line: "Work hard, vibe easy. Offsite 2026. Island jams powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/c2-06.mp3", durationMs: 9000 },
  { id: "C2-07", line: "Big ideas and warm water. Offsite 2026. Every tune powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/c2-07.mp3", durationMs: 9000 },
  { id: "C2-08", line: "One team, one week. Cancún Offsite 2026. Every beat powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/c2-08.mp3", durationMs: 9000 },
  { id: "E1-01", line: "Cancún Offsite 2026. Good vibes powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/e1-01.mp3", durationMs: 8040 },
  { id: "E1-02", line: "Cancún Offsite 2026. Island jams powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/e1-02.mp3", durationMs: 8040 },
  { id: "E1-03", line: "Offsite 2026. Every tune powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/e1-03.mp3", durationMs: 8040 },
  { id: "E1-04", line: "Sunshine and big ideas. Offsite 2026. Good vibes powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/e1-04.mp3", durationMs: 8040 },
  { id: "E1-05", line: "Welcome to the Cancún Offsite 2026. Every beat powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/e1-05.mp3", durationMs: 8040 },
  { id: "E1-06", line: "Good people, good music. Offsite 2026. Island jams powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/e1-06.mp3", durationMs: 8040 },
  { id: "E1-07", line: "Cancún Offsite 2026. The soundtrack powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/e1-07.mp3", durationMs: 8040 },
  { id: "E1-08", line: "From sessions to sunsets. Offsite 2026. Good vibes powered by Eleven Music.", url: "/offsite/cancun-2026/station-ids/e1-08.mp3", durationMs: 8040 },
];

/**
 * Shuffle-bag rotation. Plain random repeats itself often enough to be
 * noticeable in a room — drawing from a shuffled bag and only reshuffling once
 * it empties guarantees every ID plays before any repeats. `random` is
 * injectable so the ordering is testable.
 */
export function createStationIdRotation(
  ids: readonly OffsiteStationId[] = OFFSITE_STATION_IDS,
  random: () => number = Math.random
): () => OffsiteStationId | null {
  let bag: OffsiteStationId[] = [];
  let lastId: string | null = null;

  return () => {
    if (ids.length === 0) return null;
    if (bag.length === 0) {
      bag = [...ids];
      for (let i = bag.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      // Avoid a back-to-back repeat across a reshuffle boundary. Draws come off
      // the end of the bag, so the guard has to look at the last entry.
      const next = bag.length - 1;
      if (bag.length > 1 && bag[next].id === lastId) {
        [bag[next], bag[0]] = [bag[0], bag[next]];
      }
    }
    const next = bag.pop() ?? null;
    if (next) lastId = next.id;
    return next;
  };
}
