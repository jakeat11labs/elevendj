"use client";

import { useEffect, useState, type RefObject } from "react";

import { OrbShader } from "./OrbShader";

interface ReactiveOrbProps {
  /**
   * Shared analyser from useStageAudio. It is created inside the parent's mount
   * effect, so `.current` is typically still null on the orb's first render and
   * mutating a ref does not re-render — we poll for it and lift it into state.
   */
  analyserRef: RefObject<AnalyserNode | null>;
  /** Optional gradient texture URL (served from /public). */
  texture?: string;
  className?: string;
}

const DEFAULT_TEXTURE = "/orb/creative-coral.jpg";

export function ReactiveOrb({ analyserRef, texture = DEFAULT_TEXTURE, className }: ReactiveOrbProps) {
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  useEffect(() => {
    if (analyser) {
      return;
    }
    let raf = 0;
    const check = () => {
      if (analyserRef.current) {
        setAnalyser(analyserRef.current);
        return;
      }
      raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  }, [analyser, analyserRef]);

  return (
    <div
      className={className}
      style={{ position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden" }}
    >
      <OrbShader texture={texture} outputAnalyser={analyser} saturation={1.25} animated />
      {/* Film-grain overlay — matches the source orb's noiseOpacity: 0.5 look. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          mixBlendMode: "overlay",
          opacity: 0.5,
          backgroundImage: "url(/orb/noise.png)",
          backgroundSize: "256px",
          imageRendering: "pixelated",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
