"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Owns a single WebAudio graph for the stage. `createMediaElementSource` may
 * only be called once per <audio> element, so this hook centralizes it and
 * hands out refs that multiple visualizers (2D bars + the shader orb) can read.
 */
export function useStageAudio(audioRef: RefObject<HTMLAudioElement | null>) {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    let ctx: AudioContext | null = null;
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) {
        return;
      }
      ctx = new AC();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(analyser);
      analyser.connect(ctx.destination);

      ctxRef.current = ctx;
      analyserRef.current = analyser;
      freqRef.current = new Uint8Array(
        new ArrayBuffer(analyser.frequencyBinCount)
      );
    } catch {
      ctxRef.current = null;
      analyserRef.current = null;
      freqRef.current = null;
    }

    return () => {
      analyserRef.current = null;
      freqRef.current = null;
      const c = ctxRef.current;
      ctxRef.current = null;
      c?.close().catch(() => undefined);
    };
  }, [audioRef]);

  /** Resume after the user gesture that starts playback (autoplay policy). */
  const resume = useCallback(() => {
    const c = ctxRef.current;
    if (c && c.state === "suspended") {
      c.resume().catch(() => undefined);
    }
  }, []);

  return { analyserRef, freqRef, resume };
}
