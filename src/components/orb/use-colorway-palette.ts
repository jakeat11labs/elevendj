"use client";

import { useEffect, useState } from "react";

export interface ColorwayPalette {
  /** Mean color of the gradient — the dominant hue/tone. */
  primary: string;
  /** Brightest, most-saturated sample — used for the center glow. */
  accent: string;
}

// ── Background "near-match" tuning ───────────────────────────────────
// The background should feel related to the orb without being the exact same
// color: nudge the sampled hue a few degrees, pull a little saturation out, and
// deepen it slightly. Adjust these three to taste.
const HUE_SHIFT_DEG = 8; // rotate hue so the bg isn't an exact match
const SAT_MULT = 0.9; // slightly less saturated than the orb
const LIGHT_MULT = 0.88; // slightly darker than the orb

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    clamp(Math.round(n), 0, 255)
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * Shift a sampled color into its "background" form: a few degrees of hue
 * rotation plus a touch less saturation and lightness, so the stage background
 * reads as a deeper, slightly-different cousin of the orb rather than a copy.
 */
function toBackgroundTone(r: number, g: number, b: number): string {
  const [h, s, l] = rgbToHsl(r, g, b);
  const [nr, ng, nb] = hslToRgb(
    h + HUE_SHIFT_DEG,
    clamp(s * SAT_MULT, 0, 1),
    clamp(l * LIGHT_MULT, 0, 1)
  );
  return toHex(nr, ng, nb);
}

// Coral defaults (already run through the same tone shift) so SSR, first paint,
// and any sampling failure all land on the app's established look.
export const DEFAULT_PALETTE: ColorwayPalette = {
  primary: toBackgroundTone(184, 69, 47),
  accent: toBackgroundTone(255, 122, 92),
};

/**
 * Sample a same-origin gradient texture into a tiny offscreen canvas and derive
 * a two-color palette: the mean color (primary) and the most-saturated bright
 * sample (accent), each shifted into its darker/hue-rotated background tone.
 * Used to recolor the stage background to match — but not mirror — the orb.
 *
 * Same-origin `/orb/*.jpg` means the canvas is never tainted, so `getImageData`
 * is allowed. Returns `DEFAULT_PALETTE` until the image resolves and on any
 * failure (no canvas/2d context, decode error).
 */
export function useColorwayPalette(src: string): ColorwayPalette {
  const [palette, setPalette] = useState<ColorwayPalette>(DEFAULT_PALETTE);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      if (cancelled) return;
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let count = 0;

        // Track the most vivid bright pixel for the accent.
        let bestScore = -1;
        let aR = 0;
        let aG = 0;
        let aB = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const alpha = data[i + 3];
          if (alpha < 8) continue;

          rSum += r;
          gSum += g;
          bSum += b;
          count++;

          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const chroma = max - min;
          // Favor saturated, reasonably bright pixels (not near-white/near-black).
          const score = chroma * (max / 255) * (1 - Math.abs(max - 150) / 255);
          if (score > bestScore) {
            bestScore = score;
            aR = r;
            aG = g;
            aB = b;
          }
        }

        if (!count) return;

        const primary = toBackgroundTone(rSum / count, gSum / count, bSum / count);
        // Nudge the accent brighter before the tone shift so the center glow
        // still reads as light.
        const accent = toBackgroundTone(
          aR + (255 - aR) * 0.18,
          aG + (255 - aG) * 0.18,
          aB + (255 - aB) * 0.18
        );

        setPalette({ primary, accent });
      } catch {
        // Tainted canvas or decode failure — keep the coral default.
        setPalette(DEFAULT_PALETTE);
      }
    };

    img.onerror = () => {
      if (!cancelled) setPalette(DEFAULT_PALETTE);
    };

    img.src = src;

    return () => {
      cancelled = true;
    };
  }, [src]);

  return palette;
}
