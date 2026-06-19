"use client";

import { Check, Disc3, Palette, X } from "lucide-react";

import {
  COLORWAYS,
  COLORWAY_NAMES,
  type ColorwayName,
} from "@/components/orb/colorways";

/**
 * Modal grid for picking the stage orb's gradient. Purely presentational: the
 * open flag, current selection, in-flight name, and actions come from props.
 */
export function OrbColorwayPicker({
  open,
  current,
  settingName,
  onClose,
  onChoose,
}: {
  open: boolean;
  current: string;
  settingName: string | null;
  onClose: () => void;
  onChoose: (name: ColorwayName) => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="card rise w-full max-w-lg p-5"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Stage orb color"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Palette size={16} />
            Stage orb
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost inline-flex size-8 items-center justify-center"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-xs text-[var(--mid-gray)]">
          Pick the gradient for the orb on the stage screen. The background tints
          to match automatically.
        </p>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
          {COLORWAY_NAMES.map((name) => {
            const cw = COLORWAYS[name];
            const selected = name === current;
            const busy = settingName === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => onChoose(name)}
                disabled={!!settingName}
                title={cw.label}
                className={`flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] p-1.5 transition disabled:cursor-default ${
                  selected
                    ? "ring-2 ring-[var(--graphite)]"
                    : "hover:bg-[var(--cream)]"
                }`}
              >
                <span
                  className="relative size-14 rounded-full ring-1 ring-black/10"
                  style={{
                    backgroundImage: `url(${cw.src})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                >
                  {busy && (
                    <span className="absolute inset-0 grid place-items-center rounded-full bg-black/30">
                      <Disc3 size={16} className="animate-spin text-white" />
                    </span>
                  )}
                  {selected && !busy && (
                    <span className="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full bg-[var(--graphite)] text-[var(--off-white)]">
                      <Check size={11} />
                    </span>
                  )}
                </span>
                <span className="text-[10px] leading-tight text-[var(--dark-gray)]">
                  {cw.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
