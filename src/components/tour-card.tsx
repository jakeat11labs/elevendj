"use client";

import { X } from "lucide-react";
import type { CardComponentProps } from "nextstepjs";

/**
 * Branded NextStep card for the host onboarding tour. Matches the ElevenDJ
 * design tokens (graphite/cream/off-white) instead of the library default.
 *
 * Custom cards must honor `step.showControls` / `step.showSkip` themselves —
 * the default-card flags don't reach this component automatically.
 */
export function TourCard({
  step,
  currentStep,
  totalSteps,
  nextStep,
  prevStep,
  skipTour,
  arrow,
}: CardComponentProps) {
  const isFirst = currentStep === 0;
  const isLast = currentStep === totalSteps - 1;
  const showControls = step.showControls ?? true;
  const showSkip = step.showSkip ?? true;

  return (
    <div
      className="w-[min(20rem,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-[var(--light-gray)] bg-[var(--white)] p-4 shadow-xl"
      style={{ boxShadow: "0 18px 48px rgba(20,20,22,0.22)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {step.icon ? (
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--graphite)] text-base text-[var(--off-white)]"
              aria-hidden
            >
              {step.icon}
            </span>
          ) : null}
          <h3
            className="text-sm font-semibold leading-tight text-[var(--graphite)]"
            style={{ fontFamily: "var(--font-brand)" }}
          >
            {step.title}
          </h3>
        </div>
        {showSkip && (
          <button
            type="button"
            onClick={skipTour}
            className="-mr-1 -mt-1 shrink-0 rounded-full p-1 text-[var(--mid-gray)] transition hover:bg-[var(--cream)] hover:text-[var(--graphite)]"
            aria-label="Skip tour"
          >
            <X size={15} />
          </button>
        )}
      </div>

      <div className="mt-2.5 text-sm leading-6 text-[var(--dark-gray)]">
        {step.content}
      </div>

      {/* Step progress dots */}
      <div className="mt-3.5 flex items-center gap-1" aria-hidden>
        {Array.from({ length: totalSteps }).map((_, index) => (
          <span
            key={index}
            className={`h-1 flex-1 rounded-full transition-colors ${
              index <= currentStep
                ? "bg-[var(--graphite)]"
                : "bg-[var(--light-gray)]"
            }`}
          />
        ))}
      </div>

      {showControls && (
        <div className="mt-3.5 flex items-center justify-between gap-2">
          <span className="mono text-[11px] text-[var(--mid-gray)]">
            {currentStep + 1} / {totalSteps}
          </span>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                type="button"
                onClick={prevStep}
                className="btn-ghost inline-flex h-8 items-center px-3 text-xs"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={isLast ? skipTour : nextStep}
              className="btn-primary inline-flex h-8 items-center px-4 text-xs"
            >
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      )}

      {arrow}
    </div>
  );
}
