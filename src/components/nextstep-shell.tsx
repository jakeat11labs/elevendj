"use client";

import { NextStep, NextStepProvider } from "nextstepjs";

import { tours } from "@/lib/tours";

import { TourCard } from "./tour-card";

/**
 * Wraps the app so any client component under it can drive the onboarding tour
 * via `useNextStep()`. The tour itself only auto-starts on the host console
 * (see HostTourButton).
 */
export function NextStepShell({ children }: { children: React.ReactNode }) {
  return (
    <NextStepProvider>
      <NextStep
        steps={tours}
        cardComponent={TourCard}
        shadowRgb="20, 20, 22"
        shadowOpacity="0.55"
        disableConsoleLogs
      >
        {children}
      </NextStep>
    </NextStepProvider>
  );
}
