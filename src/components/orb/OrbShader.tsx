"use client";

import { Component, useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import OrbPlayerLight from "./glxp/OrbPlayerLight";
import AudioFrequencyAnalyzer from "./glxp/utils/AudioFrequencyAnalyzer";
import RAF from "./glxp/utils/RAF";
import { logger } from "./logger";
import styles from "./orb.module.css";

const ORB_RENDER_ID_BASE = "orb-webgl-render";
const AUDIO_LOOP_ID_BASE = "orb-audio-analyzer";

/** Tiny local error boundary so a WebGL failure renders nothing instead of crashing the tree. */
class OrbErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    logger.warn("Orb ErrorBoundary caught error:", error);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

export interface OrbShaderProps {
  texture: string;
  saturation?: number;
  exposure?: number;
  outputAnalyser?: AnalyserNode | null;
  inputAnalyser?: AnalyserNode | null;
  animated?: boolean;
  releaseContextAfterRender?: boolean;
  cornerRadius?: number;
  fadeInDuration?: number;
  preserveDrawingBuffer?: boolean;
  width?: number;
  height?: number;
}

export function OrbShader(props: OrbShaderProps) {
  return (
    <OrbErrorBoundary>
      <OrbShaderInner {...props} />
    </OrbErrorBoundary>
  );
}

function OrbShaderInner({
  texture,
  saturation = 1,
  exposure,
  outputAnalyser = null,
  inputAnalyser = null,
  animated = true,
  releaseContextAfterRender = true,
  cornerRadius = Infinity,
  fadeInDuration,
  preserveDrawingBuffer,
  width,
  height,
}: OrbShaderProps) {
  const id = `orb-${useId()}`;
  const [webglError, setWebglError] = useState(false);

  // Refs
  const canvasRef = useRef<HTMLDivElement>(null);
  const orbPlayerRef = useRef<OrbPlayerLight | null>(null);
  const outputFreqAnalyzerRef = useRef<AudioFrequencyAnalyzer | null>(null);
  const inputFreqAnalyzerRef = useRef<AudioFrequencyAnalyzer | null>(null);

  const disposeAll = useCallback(() => {
    try {
      orbPlayerRef.current?.dispose();
      RAF.unsubscribe(ORB_RENDER_ID_BASE + id);
      RAF.unsubscribe(AUDIO_LOOP_ID_BASE + id);
    } catch (e) {
      logger.warn("Orb cleanup failed:", e);
    }
    orbPlayerRef.current = null;
    outputFreqAnalyzerRef.current = null;
    inputFreqAnalyzerRef.current = null;
  }, [id]);

  const handleWebglError = useCallback(
    (err: unknown) => {
      logger.warn("Orb WebGL error, falling back to placeholder:", err);
      disposeAll();
      setWebglError(true);
    },
    [disposeAll],
  );

  // Initialize AudioFrequencyAnalyzer when the output analyser is provided
  useEffect(() => {
    if (outputAnalyser) {
      outputFreqAnalyzerRef.current = new AudioFrequencyAnalyzer(null, outputAnalyser);
    } else {
      outputFreqAnalyzerRef.current = null;
      // Reset audio data when analyser is removed
      if (orbPlayerRef.current) {
        orbPlayerRef.current.setAudioData(
          { low: 0, mid: 0, high: 0, all: 0 },
          inputFreqAnalyzerRef.current
            ? {
                low: inputFreqAnalyzerRef.current.lowAvg / 255,
                mid: inputFreqAnalyzerRef.current.midAvg / 255,
                high: inputFreqAnalyzerRef.current.highAvg / 255,
                all: inputFreqAnalyzerRef.current.allAvg / 255,
              }
            : null,
          0,
        );
      }
    }
  }, [outputAnalyser]);

  useEffect(() => {
    if (inputAnalyser) {
      inputFreqAnalyzerRef.current = new AudioFrequencyAnalyzer(null, inputAnalyser);
    } else {
      inputFreqAnalyzerRef.current = null;
      // Reset audio data when analyser is removed
      if (orbPlayerRef.current) {
        orbPlayerRef.current.setAudioData(
          outputFreqAnalyzerRef.current
            ? {
                low: outputFreqAnalyzerRef.current.lowAvg / 255,
                mid: outputFreqAnalyzerRef.current.midAvg / 255,
                high: outputFreqAnalyzerRef.current.highAvg / 255,
                all: outputFreqAnalyzerRef.current.allAvg / 255,
              }
            : null,
          { low: 0, mid: 0, high: 0, all: 0 },
          0,
        );
      }
    }
  }, [inputAnalyser]);

  // Store initial texture URL + saturation to avoid re-instantiating on change
  const initialTextureUrlRef = useRef(texture);
  const initialSaturationRef = useRef(saturation);

  // Initialize WebGL on mount
  useEffect(() => {
    if (!canvasRef.current) return;

    try {
      const orbPlayer = new OrbPlayerLight(canvasRef.current, {
        width,
        height,
        rafId: ORB_RENDER_ID_BASE + id,
        animated,
        cornerRadius: cornerRadius * (parseFloat(window.getComputedStyle(document.documentElement).fontSize) / 16),
        saturation: initialSaturationRef.current,
        fadeInDuration,
        preserveDrawingBuffer,
      });
      orbPlayerRef.current = orbPlayer;

      if (exposure !== undefined) {
        orbPlayer.setConfig("exposure", exposure);
      }

      orbPlayer
        .loadTexture(initialTextureUrlRef.current)
        .then(() => {
          if (orbPlayer.isDisposed) {
            return;
          }
          if (animated) {
            orbPlayer.play();
          } else {
            if (releaseContextAfterRender) {
              orbPlayer.playOnce();
              orbPlayer.dispose(true);
            } else {
              orbPlayer.playOnce();
            }
          }
        })
        .catch(handleWebglError);
    } catch (err) {
      handleWebglError(err);
    }

    return disposeAll;
  }, [
    animated,
    id,
    releaseContextAfterRender,
    cornerRadius,
    fadeInDuration,
    preserveDrawingBuffer,
    handleWebglError,
    disposeAll,
  ]);

  // Watch for textureUrl changes and update texture without re-instantiating the player
  useEffect(() => {
    if (texture === initialTextureUrlRef.current) return;

    initialTextureUrlRef.current = texture;

    if (orbPlayerRef.current) {
      orbPlayerRef.current.loadTexture(texture).catch(handleWebglError);
    }
  }, [texture, handleWebglError]);

  // Apply saturation changes live so colorway switches recolor the orb without
  // tearing down the player — the audio-reactive loop keeps running.
  useEffect(() => {
    if (saturation === initialSaturationRef.current) return;

    initialSaturationRef.current = saturation;
    orbPlayerRef.current?.setSaturation(saturation);
  }, [saturation]);

  // Audio analysis loop (separate from WebGL render loop, using RAF singleton)
  useEffect(() => {
    RAF.subscribe(AUDIO_LOOP_ID_BASE + id, (dt: number) => {
      if (outputFreqAnalyzerRef.current) {
        outputFreqAnalyzerRef.current.update();
      }
      if (inputFreqAnalyzerRef.current) {
        inputFreqAnalyzerRef.current.update();
      }

      if (orbPlayerRef.current) {
        const outputData = outputFreqAnalyzerRef.current;
        const inputData = inputFreqAnalyzerRef.current;

        orbPlayerRef.current.setAudioData(
          outputData
            ? {
                low: outputData.lowAvg / 255,
                mid: outputData.midAvg / 255,
                high: outputData.highAvg / 255,
                all: outputData.allAvg / 255,
              }
            : null,
          inputData
            ? {
                low: inputData.lowAvg / 255,
                mid: inputData.midAvg / 255,
                high: inputData.highAvg / 255,
                all: inputData.allAvg / 255,
              }
            : null,
          dt / 1000,
        );
      }
    });

    return () => {
      RAF.unsubscribe(AUDIO_LOOP_ID_BASE + id);
    };
  }, [id]);

  if (webglError) {
    return null;
  }

  return <div ref={canvasRef} className={styles.shaderRoot} />;
}
