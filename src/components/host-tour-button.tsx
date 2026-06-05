"use client";

import { useEffect, useRef } from "react";
import { Compass } from "lucide-react";
import { useNextStep } from "nextstepjs";

import { HOST_TOUR_ID, HOST_TOUR_KEY } from "@/lib/tours";

/**
 * Auto-starts the host onboarding tour the first time a given user lands on the
 * console, and renders a "Take a tour" button so they can replay it later.
 * The "seen" flag is per-user in localStorage so a shared browser doesn't hide
 * the tour from a second host.
 */
export function HostTourButton({
  userId,
  autoStart = true,
}: {
  userId: string;
  /** When false, suppress the first-run auto-start (e.g. while the API-key
   * setup gate is open). The manual button still works. Once this flips true
   * the auto-start runs. */
  autoStart?: boolean;
}) {
  const { startNextStep } = useNextStep();
  const started = useRef(false);

  useEffect(() => {
    if (!autoStart || started.current) {
      return;
    }
    started.current = true;
    const key = `${HOST_TOUR_KEY}:${userId}`;
    let seen = false;
    try {
      seen = window.localStorage.getItem(key) === "true";
    } catch {
      /* private mode / storage blocked — just show the tour */
    }
    if (seen) {
      return;
    }
    try {
      window.localStorage.setItem(key, "true");
    } catch {
      /* ignore */
    }
    // Let the console render its targets before anchoring the first step.
    const timer = window.setTimeout(() => startNextStep(HOST_TOUR_ID), 600);
    return () => window.clearTimeout(timer);
  }, [autoStart, startNextStep, userId]);

  return (
    <button
      type="button"
      onClick={() => startNextStep(HOST_TOUR_ID)}
      className="btn-ghost inline-flex h-9 items-center gap-2 px-3 text-sm"
      title="Take a tour of the console"
    >
      <Compass size={15} />
      <span className="hidden sm:inline">Take a tour</span>
    </button>
  );
}
