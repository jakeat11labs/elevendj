export type MusicStyle = {
  id: string;
  label: string;
  /** Richer than the label; this is what Music v2 receives. */
  direction: string;
};

export const POPULAR_MUSIC_STYLES: readonly MusicStyle[] = [
  {
    id: "house",
    label: "House",
    direction: "house music, four-on-the-floor groove, warm bass, polished club production",
  },
  {
    id: "pop",
    label: "Pop",
    direction: "modern pop, memorable hook, bright arrangement, polished production",
  },
  {
    id: "rock",
    label: "Rock",
    direction: "energetic rock, live drums, electric guitars, strong dynamic build",
  },
  {
    id: "country",
    label: "Country",
    direction: "modern country, organic guitars, warm rhythm section, open-road energy",
  },
  {
    id: "hip-hop",
    label: "Hip-hop",
    direction: "hip-hop, deep drums, confident groove, spacious modern production",
  },
  {
    id: "r-and-b",
    label: "R&B",
    direction: "R&B and neo-soul, silky chords, pocket drums, warm expressive production",
  },
  {
    id: "disco",
    label: "Disco",
    direction: "disco and funk, elastic bass, rhythmic guitar, celebratory dance-floor energy",
  },
  {
    id: "latin",
    label: "Latin",
    direction: "Latin dance, syncopated percussion, melodic warmth, festive movement",
  },
] as const;

export const WILDCARD_MUSIC_STYLES: readonly MusicStyle[] = [
  {
    id: "yacht-rock",
    label: "Yacht rock",
    direction: "yacht rock, soft-rock harmony, glossy electric piano, breezy marina feel",
  },
  {
    id: "desert-disco",
    label: "Desert disco",
    direction: "desert disco, dry hand percussion, hypnotic bass, shimmering night-drive synths",
  },
  {
    id: "tropical-noir",
    label: "Tropical noir",
    direction: "tropical noir, shadowy lounge rhythm, humid percussion, cinematic mystery",
  },
  {
    id: "space-western",
    label: "Space western",
    direction: "space western, twang guitar, cosmic synths, cinematic frontier pulse",
  },
  {
    id: "medieval-synthwave",
    label: "Medieval synthwave",
    direction: "medieval synthwave, modal melody, analog arpeggios, heroic electronic drums",
  },
  {
    id: "surf-jazz",
    label: "Surf jazz",
    direction: "surf jazz, spring-reverb guitar, brushed drums, playful coastal swing",
  },
  {
    id: "cosmic-country",
    label: "Cosmic country",
    direction: "cosmic country, pedal steel, psychedelic ambience, laid-back road-song groove",
  },
  {
    id: "jungle-funk",
    label: "Jungle funk",
    direction: "jungle funk, interlocking percussion, elastic bass, bright horn punctuations",
  },
  {
    id: "cinematic-bossa",
    label: "Cinematic bossa",
    direction: "cinematic bossa nova, nylon guitar, elegant strings, soft ocean-night rhythm",
  },
  {
    id: "gospel-house",
    label: "Gospel house",
    direction: "gospel house, uplifting piano, soulful choir textures, joyful club groove",
  },
] as const;

export const ALL_MUSIC_STYLES = [
  ...POPULAR_MUSIC_STYLES,
  ...WILDCARD_MUSIC_STYLES,
] as const;

const BY_ID = new Map(ALL_MUSIC_STYLES.map((style) => [style.id, style]));

export function resolveMusicStyle(
  styleId: string | null | undefined
): MusicStyle | null {
  return styleId ? BY_ID.get(styleId) ?? null : null;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Three stable wildcards per room/day; refresh tomorrow, not every render. */
export function rotatingWildcardStyles(
  seed: string,
  count = 3
): MusicStyle[] {
  const pool = [...WILDCARD_MUSIC_STYLES];
  let state = hashSeed(seed);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, Math.max(0, Math.min(count, pool.length)));
}

export function musicStyleChoices(seed: string) {
  return {
    popular: [...POPULAR_MUSIC_STYLES],
    wildcards: rotatingWildcardStyles(seed),
  };
}
