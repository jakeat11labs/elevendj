"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Owns a single WebAudio graph for the stage, fed by TWO <audio> elements
 * ("decks") so tracks can crossfade — each deck runs through its own GainNode
 * into a shared analyser, and a crossfade is just ramping one gain down while
 * the other comes up.
 *
 * `createMediaElementSource` may only be called **once per <audio> element** — a
 * second call throws `InvalidStateError`. React Strict Mode (and HMR) mount
 * effects twice (mount → cleanup → mount), so a naive create-on-mount graph
 * silently breaks on the second mount and the analyser ends up null. To stay
 * correct we cache the graph (keyed on deck A) in a module-level WeakMap and
 * never tear it down: the source nodes are permanently bound to their elements.
 */
export type Deck = "a" | "b";

type StageGraph = {
  ctx: AudioContext;
  analyser: AnalyserNode;
  gains: { a: GainNode; b: GainNode };
};

const graphCache = new WeakMap<HTMLAudioElement, StageGraph>();

function getOrCreateGraph(
  a: HTMLAudioElement,
  b: HTMLAudioElement
): StageGraph | null {
  const cached = graphCache.get(a);
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
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.82;
    analyser.connect(ctx.destination);

    const wire = (el: HTMLAudioElement, initialGain: number) => {
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = initialGain;
      source.connect(gain);
      gain.connect(analyser);
      return gain;
    };

    // Deck A starts audible, deck B silent.
    const graph: StageGraph = {
      ctx,
      analyser,
      gains: { a: wire(a, 1), b: wire(b, 0) },
    };
    graphCache.set(a, graph);
    graphCache.set(b, graph);
    return graph;
  } catch {
    return null;
  }
}

export function useStageAudio(
  aRef: RefObject<HTMLAudioElement | null>,
  bRef: RefObject<HTMLAudioElement | null>
) {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const gainsRef = useRef<{ a: GainNode; b: GainNode } | null>(null);

  useEffect(() => {
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) {
      return;
    }

    const graph = getOrCreateGraph(a, b);
    if (!graph) {
      return;
    }

    ctxRef.current = graph.ctx;
    analyserRef.current = graph.analyser;
    gainsRef.current = graph.gains;
    freqRef.current = new Uint8Array(
      new ArrayBuffer(graph.analyser.frequencyBinCount)
    );

    // Intentionally no teardown: the MediaElementSources are permanently bound
    // to their elements, so closing the context here would break audio + the
    // orb on the next mount. The cached graph is reused instead.
  }, [aRef, bRef]);

  /** Resume after the user gesture that starts playback (autoplay policy). */
  const resume = useCallback(() => {
    const c = ctxRef.current;
    if (c && c.state === "suspended") {
      c.resume().catch(() => undefined);
    }
  }, []);

  /** Snap a deck's crossfade gain to a value immediately (cancels any ramp). */
  const setDeckGain = useCallback((deck: Deck, value: number) => {
    const gains = gainsRef.current;
    const ctx = ctxRef.current;
    if (!gains || !ctx) {
      return;
    }
    const g = gains[deck].gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(value, ctx.currentTime);
  }, []);

  /** Ramp `to` up to full and `from` down to silent over `durationSec`. */
  const crossfade = useCallback(
    (from: Deck, to: Deck, durationSec: number) => {
      const gains = gainsRef.current;
      const ctx = ctxRef.current;
      if (!gains || !ctx) {
        return;
      }
      const now = ctx.currentTime;
      const fromG = gains[from].gain;
      const toG = gains[to].gain;
      fromG.cancelScheduledValues(now);
      toG.cancelScheduledValues(now);
      // Pin current values so the ramp starts from where we are.
      fromG.setValueAtTime(fromG.value, now);
      toG.setValueAtTime(Math.max(toG.value, 0.0001), now);
      toG.linearRampToValueAtTime(1, now + durationSec);
      fromG.linearRampToValueAtTime(0, now + durationSec);
    },
    []
  );

  return { analyserRef, freqRef, resume, setDeckGain, crossfade };
}
