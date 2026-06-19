"use client";

import {
  Check,
  ChevronDown,
  Disc3,
  Music2,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";

// Starter prompts for the host's own composer — DJ-flavored, not the
// audience-facing suggestions on the public form.
const HOST_IDEAS = [
  "Peak-time tech house, rolling bassline, big filtered build",
  "Smooth jazz-funk transition groove",
  "Crowd-hype anthem with a huge drop",
  "Downtempo cooldown, warm analog pads",
] as const;

/**
 * DJ booth — the host's own track composer (prompt + credit name + instrumental
 * toggle + quick ideas) plus the in-flight job progress stepper. Purely
 * presentational; all composer state and the submit action come from props.
 */
export function DjBooth({
  prompt,
  onPromptChange,
  remaining,
  trimmed,
  name,
  onNameChange,
  instrumental,
  onToggleInstrumental,
  ideasOpen,
  onToggleIdeas,
  submitting,
  canSubmit,
  onSubmit,
  job,
  jobFailed,
  jobDone,
  jobStep,
  jobMessage,
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  remaining: number;
  trimmed: string;
  name: string;
  onNameChange: (value: string) => void;
  instrumental: boolean;
  onToggleInstrumental: () => void;
  ideasOpen: boolean;
  onToggleIdeas: () => void;
  submitting: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  job: { requestId: string; clientToken: string } | null;
  jobFailed: boolean;
  jobDone: boolean;
  jobStep: number;
  jobMessage: string;
}) {
  return (
    <section id="tour-dj-booth" className="card rise overflow-hidden p-0">
      <div className="flex items-center gap-2.5 bg-[var(--graphite)] px-4 py-3 sm:px-5">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--off-white)]"
          style={{ background: "rgba(255,255,255,0.12)" }}
        >
          <Wand2 size={15} />
        </span>
        <div className="min-w-0">
          <p
            className="text-sm font-semibold text-[var(--off-white)]"
            style={{ fontFamily: "var(--font-brand)" }}
          >
            DJ booth
          </p>
          <p
            className="truncate text-[11px]"
            style={{ color: "rgba(255,255,255,0.6)" }}
          >
            Spin your own track straight into the queue
          </p>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <label className="block">
          <span className="eyebrow mb-2 flex items-center justify-between gap-3">
            <span>Prompt</span>
            <span
              className={`mono text-xs ${
                remaining < 0
                  ? "text-[var(--destructive)]"
                  : "text-[var(--mid-gray)]"
              }`}
            >
              {remaining}
            </span>
          </span>
          <textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            maxLength={800}
            rows={3}
            className="control min-h-[92px] w-full resize-none rounded-[var(--radius-lg)] p-3.5 text-sm leading-6"
            placeholder="Driving peak-time tech house with a deep rolling bassline and a big filtered build"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
        </label>

        {/* Quick ideas — collapsed by default to save space */}
        <div className="mt-2">
          <button
            type="button"
            onClick={onToggleIdeas}
            aria-expanded={ideasOpen}
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--mid-gray)] transition hover:text-[var(--graphite)]"
          >
            <ChevronDown
              size={12}
              className={`shrink-0 transition-transform ${ideasOpen ? "rotate-180" : ""}`}
            />
            Quick ideas
          </button>
          {ideasOpen && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {HOST_IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => onPromptChange(idea)}
                  className="rounded-full border border-[var(--light-gray)] bg-[var(--white)] px-2 py-0.5 text-[10px] leading-snug text-[var(--dark-gray)] transition hover:border-[var(--graphite)] hover:text-[var(--graphite)]"
                >
                  {idea}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Credit name + instrumental */}
        <div className="mt-3 flex items-center gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Credit name</span>
            <input
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              maxLength={40}
              className="control h-10 w-full px-3 text-sm"
              placeholder="Host"
            />
          </label>
          <button
            type="button"
            role="switch"
            aria-checked={instrumental}
            onClick={onToggleInstrumental}
            title="Instrumental only"
            className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border px-3 text-xs font-medium transition ${
              instrumental
                ? "border-[var(--graphite)] bg-[var(--graphite)] text-[var(--off-white)]"
                : "border-[var(--light-gray)] bg-[var(--white)] text-[var(--dark-gray)] hover:border-[var(--graphite)]"
            }`}
          >
            <Music2 size={14} />
            Instrumental
          </button>
        </div>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="btn-primary mt-3 inline-flex h-11 w-full items-center justify-center gap-2 text-sm"
        >
          {submitting ? (
            <Disc3 className="animate-spin" size={17} />
          ) : (
            <Sparkles size={17} />
          )}
          {submitting ? "Spinning up…" : "Drop into queue"}
        </button>

        {job ? (
          <div
            className={`rise mt-3 rounded-[var(--radius-md)] border p-3 ${
              jobFailed
                ? "border-[var(--destructive)] bg-[rgba(180,35,24,0.05)]"
                : jobDone
                  ? "border-[var(--graphite)] bg-[var(--cream)]"
                  : "border-[var(--light-gray)] bg-[var(--white)]"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                  jobFailed
                    ? "bg-[var(--destructive)] text-[var(--off-white)]"
                    : jobDone
                      ? "bg-[var(--graphite)] text-[var(--off-white)]"
                      : "bg-[var(--light-gray)] text-[var(--graphite)]"
                }`}
              >
                {jobFailed ? (
                  <X size={13} />
                ) : jobDone ? (
                  <Check size={13} />
                ) : (
                  <Disc3 size={13} className="animate-spin" />
                )}
              </span>
              <p className="min-w-0 flex-1 text-xs font-medium text-[var(--graphite)]">
                {jobMessage}
              </p>
            </div>

            {!jobFailed && (
              <div className="mt-2.5 flex gap-1">
                {["Queued", "Generating", "Ready"].map((label, index) => {
                  const reached = jobStep >= index;
                  const active = jobStep === index && !jobDone;
                  return (
                    <div key={label} className="flex-1">
                      <div
                        className={`h-1 rounded-full transition-colors ${
                          reached
                            ? "bg-[var(--graphite)]"
                            : "bg-[var(--light-gray)]"
                        } ${active ? "animate-pulse" : ""}`}
                      />
                      <span className="mt-1 block text-[9px] uppercase tracking-[0.12em] text-[var(--mid-gray)]">
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : trimmed.length > 0 && trimmed.length < 10 ? (
          <p className="mt-2.5 text-xs text-[var(--mid-gray)]">
            A few more words — at least 10 characters.
          </p>
        ) : (
          <p className="mt-2.5 text-[11px] text-[var(--mid-gray)]">
            Queues instantly, even with the line paused or in approval mode.{" "}
            <span className="mono">⌘↵</span> to send.
          </p>
        )}
      </div>
    </section>
  );
}
