"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Owns a single WebAudio graph for the stage. `createMediaElementSource` may
 * only be called **once per <audio> element** — a second call throws
 * `InvalidStateError`. React Strict Mode (and HMR) mount effects twice
 * (mount → cleanup → mount), so a naive create-on-mount/close-on-cleanup graph
 * silently breaks on the second mount and the analyser ends up null — the orb
 * then never reacts to audio.
 *
 * To stay correct across remounts we cache the graph per element in a
 * module-level WeakMap and never tear it down: the source node is permanently
 * bound to the element, so the graph is meant to live as long as the element.
 */
type StageGraph = {
  ctx: AudioContext;
  analyser: AnalyserNode;
};

const graphCache = new WeakMap<HTMLAudioElement, StageGraph>();

function getOrCreateGraph(audio: HTMLAudioElement): StageGraph | null {
  const cached = graphCache.get(audio);
  if (cached) {
    return cached;
  }
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) {
      return null;
    }
    const ctx = new AC();
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);
    analyser.connect(ctx.destination);

    const graph: StageGraph = { ctx, analyser };
    graphCache.set(audio, graph);
    return graph;
  } catch {
    return null;
  }
}

export function useStageAudio(audioRef: RefObject<HTMLAudioElement | null>) {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const graph = getOrCreateGraph(audio);
    if (!graph) {
      return;
    }

    ctxRef.current = graph.ctx;
    analyserRef.current = graph.analyser;
    freqRef.current = new Uint8Array(
      new ArrayBuffer(graph.analyser.frequencyBinCount)
    );

    // Intentionally no teardown: the MediaElementSource is permanently bound to
    // this element, so closing the context here would break audio + the orb on
    // the next mount. The cached graph is reused instead (see getOrCreateGraph).
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
