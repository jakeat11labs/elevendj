// Orb colorways — gradient textures served from /public/orb. Ported from the
// reactive-orb source. This module is isomorphic (no "use client", no secrets):
// it holds only public asset paths so both the server (settings validation,
// snapshot) and the client (host picker, stage) can import it.
//
// `saturation` is the orb shader's default boost for that gradient. `label` is
// the human name shown in the host picker.

export interface Colorway {
  src: string;
  saturation: number;
  label: string;
}

export const COLORWAYS = {
  "creative-1": { src: "/orb/creative-1.jpg", saturation: 1.25, label: "Creative 1" },
  "creative-2": { src: "/orb/creative-2.jpg", saturation: 1, label: "Creative 2" },
  "creative-3": { src: "/orb/creative-3.jpg", saturation: 1, label: "Creative 3" },
  "creative-4": { src: "/orb/creative-4.jpg", saturation: 1, label: "Creative 4" },
  "creative-5": { src: "/orb/creative-5.jpg", saturation: 1, label: "Creative 5" },
  "creative-6": { src: "/orb/creative-6.jpg", saturation: 1, label: "Creative 6" },
  "creative-7": { src: "/orb/creative-7.jpg", saturation: 1, label: "Creative 7" },
  "creative-8": { src: "/orb/creative-8.jpg", saturation: 1, label: "Creative 8" },
  "creative-9": { src: "/orb/creative-9.jpg", saturation: 1, label: "Creative 9" },
  "agents-1": { src: "/orb/agents-1.jpg", saturation: 1, label: "Agents 1" },
  "agents-2": { src: "/orb/agents-2.jpg", saturation: 1, label: "Agents 2" },
  "agents-3": { src: "/orb/agents-3.jpg", saturation: 1, label: "Agents 3" },
  "agents-4": { src: "/orb/agents-4.jpg", saturation: 1, label: "Agents 4" },
  "agents-5": { src: "/orb/agents-5.jpg", saturation: 1, label: "Agents 5" },
  "agents-6": { src: "/orb/agents-6.jpg", saturation: 1, label: "Agents 6" },
  "agents-7": { src: "/orb/agents-7.jpg", saturation: 1, label: "Agents 7" },
  "agents-8": { src: "/orb/agents-8.jpg", saturation: 1, label: "Agents 8" },
  "agents-9": { src: "/orb/agents-9.jpg", saturation: 1, label: "Agents 9" },
  "speech-engine": { src: "/orb/speech-engine.jpg", saturation: 1, label: "Speech Engine" },
} satisfies Record<string, Colorway>;

export type ColorwayName = keyof typeof COLORWAYS;

export const COLORWAY_NAMES = Object.keys(COLORWAYS) as [
  ColorwayName,
  ...ColorwayName[],
];

export const DEFAULT_COLORWAY: ColorwayName = "creative-1";

/**
 * Resolve a stored colorway name to its definition, falling back to the default
 * when the value is unknown (e.g. an older row, or a name retired from the
 * registry). Always returns a registry entry — never indexes a raw string into
 * a URL.
 */
export function resolveColorway(name: string | null | undefined): Colorway {
  if (name && name in COLORWAYS) {
    return COLORWAYS[name as ColorwayName];
  }
  return COLORWAYS[DEFAULT_COLORWAY];
}
