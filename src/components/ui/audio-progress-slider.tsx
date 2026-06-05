"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import type { ComponentPropsWithoutRef } from "react";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type AudioProgressSliderProps = Omit<
  ComponentPropsWithoutRef<typeof SliderPrimitive.Root>,
  "min" | "max" | "value" | "defaultValue" | "onValueChange" | "step"
> & {
  value: number;
  duration: number;
  step?: number;
  onSeek: (seconds: number) => void;
  trackClassName?: string;
  rangeClassName?: string;
  thumbClassName?: string;
};

export function AudioProgressSlider({
  value,
  duration,
  step = 0.25,
  onSeek,
  className,
  trackClassName,
  rangeClassName,
  thumbClassName,
  disabled,
  ...props
}: AudioProgressSliderProps) {
  const safeDuration =
    Number.isFinite(duration) && !Number.isNaN(duration) && duration > 0
      ? duration
      : 0;
  const safeValue =
    safeDuration > 0 ? Math.min(safeDuration, Math.max(0, value)) : 0;
  const isDisabled = disabled || safeDuration <= 0;

  return (
    <SliderPrimitive.Root
      {...props}
      className={cx(className)}
      value={[safeValue]}
      min={0}
      max={safeDuration}
      step={step}
      disabled={isDisabled}
      onValueChange={(vals) => onSeek(vals[0] ?? 0)}
    >
      <SliderPrimitive.Track className={trackClassName}>
        <SliderPrimitive.Range className={rangeClassName} />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className={thumbClassName} />
    </SliderPrimitive.Root>
  );
}
