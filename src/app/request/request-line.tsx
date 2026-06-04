"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Disc3, RotateCcw, Send } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { useRealtimeRefresh } from "@/lib/use-realtime-refresh";
import type { QueueItem } from "@/lib/status";

type Submission = {
  requestId: string;
  clientToken: string;
  status: QueueItem["status"];
  queuePosition: number | null;
};

type ApiError = {
  message?: string;
  suggestion?: string;
};

const STEPS = ["Queued", "Generating", "Ready"] as const;

const SUGGESTIONS = [
  "High-energy synthwave, midnight drive",
  "Sunset deep house, warm bassline",
  "Lo-fi hip-hop, rainy night study",
  "Afrobeat groove, bright percussion",
  "Cinematic orchestral build",
  "Funky disco with slap bass",
] as const;

export function RequestLine() {
  const [prompt, setPrompt] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [submittedName, setSubmittedName] = useState<string | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [status, setStatus] = useState<QueueItem | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(true);

  // Poll the public now-playing endpoint for the open/closed flag so the form
  // reflects the host pausing requests (the server also enforces this).
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/now-playing", { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled && typeof body?.requestsOpen === "boolean") {
          setRequestsOpen(body.requestsOpen);
        }
      } catch {
        /* keep last known state */
      }
    };
    check();
    const interval = window.setInterval(check, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const remaining = 800 - prompt.length;
  const canSubmit =
    requestsOpen &&
    prompt.trim().length >= 10 &&
    requesterName.trim().length > 0 &&
    remaining >= 0 &&
    !isSubmitting;

  const refreshStatus = useCallback(async () => {
    if (!submission) {
      return;
    }

    const response = await fetch(
      `/api/requests/${submission.requestId}?token=${encodeURIComponent(
        submission.clientToken
      )}`
    );
    if (response.ok) {
      setStatus((await response.json()) as QueueItem);
    }
  }, [submission]);

  useRealtimeRefresh(refreshStatus, submission?.requestId);

  useEffect(() => {
    if (!submission) {
      return;
    }

    refreshStatus();
    const interval = window.setInterval(refreshStatus, 3500);
    return () => window.clearInterval(interval);
  }, [refreshStatus, submission]);

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          requesterName: requesterName.trim(),
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body as ApiError);
        return;
      }

      setSubmission(body as Submission);
      setStatus(null);
      setSubmittedName(requesterName.trim() || null);
      setPrompt("");
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetForm() {
    setSubmission(null);
    setStatus(null);
    setSubmittedName(null);
    setError(null);
    setPrompt("");
  }

  const displayStatus = status?.status ?? submission?.status;
  const position = status?.position ?? submission?.queuePosition;

  const statusCopy = useMemo(() => {
    if (!displayStatus) {
      return "Send a request to join the live queue.";
    }
    if (displayStatus === "pending") {
      return "Waiting for the host to approve your request.";
    }
    if (displayStatus === "queued") {
      return `Queued${position ? ` at #${position}` : ""}.`;
    }
    if (displayStatus === "generating") {
      return "Generating your track now.";
    }
    if (displayStatus === "ready") {
      return "Ready — your track is in the player.";
    }
    if (displayStatus === "rejected") {
      return status?.promptSuggestion || status?.errorMessage || "Request rejected.";
    }
    if (displayStatus === "failed") {
      return status?.errorMessage || "Generation failed.";
    }
    return "Played.";
  }, [displayStatus, position, status]);

  // Index reached in the 3-step Queued → Generating → Ready indicator.
  const reachedStep =
    displayStatus === "queued"
      ? 0
      : displayStatus === "generating"
        ? 1
        : displayStatus === "ready" ||
            displayStatus === "played" ||
            displayStatus === "archived"
          ? 2
          : -1;

  // Name the submitter gave at request time — shown as attribution in the
  // status panel even before the first status fetch returns it.
  const attribution = status?.requesterName ?? submittedName;

  // ── Confirmation screen — shown once a request is in flight ──────
  if (submission && displayStatus) {
    return (
      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 sm:px-8 sm:pb-16 sm:pt-14">
        <div className="rise flex items-center justify-between gap-4">
          <div>
            <p className="eyebrow mb-1">Your request</p>
            <p className="text-sm text-[var(--mid-gray)]">
              {attribution ? `for ${attribution}` : "Anonymous"}
            </p>
          </div>
          <StatusBadge status={displayStatus} />
        </div>

        <div className="rise mt-5 flex flex-1 flex-col rounded-[var(--radius-lg)] border border-[var(--light-gray)] bg-[var(--white)] p-6 shadow-[var(--shadow-sm)]">
          <div className="flex flex-1 flex-col justify-center text-center">
            <p
              className="display text-balance leading-tight"
              style={{ fontSize: "clamp(1.5rem, 3.2vw, 2rem)" }}
            >
              {statusCopy}
            </p>
            {status?.audioUrl && (
              <audio className="mt-6 w-full" controls src={status.audioUrl}>
                <track kind="captions" />
              </audio>
            )}
          </div>

          <ol className="mt-6 grid grid-cols-3 gap-2">
            {STEPS.map((label, index) => {
              const reached = reachedStep >= index;
              const active = reachedStep === index;
              return (
                <li
                  key={label}
                  className={`flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] border p-3 transition ${
                    reached
                      ? "border-[var(--graphite)] bg-[var(--cream)]"
                      : "border-[var(--light-gray)]"
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                      reached
                        ? "bg-[var(--graphite)] text-[var(--off-white)]"
                        : "bg-[var(--light-gray)] text-[var(--mid-gray)]"
                    } ${active ? "animate-pulse" : ""}`}
                  >
                    {index + 1}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--mid-gray)]">
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <button
          type="button"
          onClick={resetForm}
          className="btn-ghost rise mt-4 inline-flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] text-base active:scale-[0.99] sm:h-12"
        >
          <RotateCcw size={18} />
          Send another request
        </button>
      </main>
    );
  }

  // ── Request form — app-style screen that fills the viewport ──────
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 sm:max-w-[920px] sm:px-8 sm:pb-14 sm:pt-12">
      <header className="rise mb-5 shrink-0 sm:mb-7">
        <p className="eyebrow mb-2">Live request line</p>
        <h1
          className="display leading-[1.05]"
          style={{ fontSize: "clamp(1.75rem, 2.6vw, 2.25rem)" }}
        >
          Request a track
        </h1>
        <p className="mt-2 hidden text-base leading-7 text-[var(--dark-gray)] sm:block">
          Describe the mood, tempo, and instruments — the AI DJ generates it and
          drops it straight into the live queue.
        </p>
      </header>

      <form
        onSubmit={submitRequest}
        className="rise flex flex-1 flex-col gap-4 sm:grid sm:flex-none sm:grid-cols-[1.15fr_0.85fr] sm:items-stretch sm:gap-x-8 sm:gap-y-4 sm:rounded-[var(--radius-xl)] sm:border sm:border-[var(--light-gray)] sm:bg-[var(--cream)] sm:p-8 sm:shadow-[var(--shadow-sm)]"
        style={{ animationDelay: "80ms" }}
      >
        {!requestsOpen && (
          <div className="shrink-0 rounded-[var(--radius-md)] border border-[var(--light-gray)] bg-[var(--cream)] p-4 text-sm text-[var(--dark-gray)] sm:col-span-2 sm:bg-[var(--white)]">
            <span className="font-semibold text-[var(--graphite)]">
              Requests are paused.
            </span>{" "}
            The host has closed the line for now — check back soon.
          </div>
        )}

        {/* Left column — the prompt is the focus */}
        <label className="flex min-h-0 flex-1 flex-col sm:flex-none">
          <span className="eyebrow mb-2 flex items-center justify-between gap-3">
            <span>Your prompt</span>
            <span
              className={`mono text-xs ${
                remaining < 0 ? "text-[var(--destructive)]" : "text-[var(--mid-gray)]"
              }`}
            >
              {remaining}
            </span>
          </span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={800}
            disabled={!requestsOpen}
            className="control min-h-[128px] w-full flex-1 resize-none rounded-[var(--radius-lg)] p-4 text-base leading-7 sm:min-h-[240px]"
            placeholder="High-energy synthwave with punchy drums, bright arps, and a clean midnight-drive feel"
          />
          <span className="mt-2 hidden text-sm text-[var(--mid-gray)] sm:block">
            Mood, tempo, instruments, and scene.
          </span>
        </label>

        {/* Right column on desktop / bottom-anchored group on mobile */}
        <div className="flex shrink-0 flex-col gap-4 sm:gap-5">
          <div className="hidden sm:block">
            <span className="eyebrow mb-2 block">Need a starting point?</span>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setPrompt(suggestion)}
                  disabled={!requestsOpen}
                  className="rounded-full border border-[var(--light-gray)] bg-[var(--white)] px-3 py-1.5 text-sm text-[var(--dark-gray)] transition hover:border-[var(--graphite)] hover:text-[var(--graphite)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          <label className="block sm:mt-auto">
            <span className="eyebrow mb-2 block">
              Name <span className="text-[var(--destructive)]">*</span>
            </span>
            <input
              value={requesterName}
              onChange={(event) => setRequesterName(event.target.value)}
              disabled={!requestsOpen}
              maxLength={40}
              required
              className="control h-14 w-full rounded-[var(--radius-lg)] px-4 sm:h-12"
              placeholder="Your name"
            />
          </label>

          {error && (
            <div className="rounded-[var(--radius-md)] border border-[var(--destructive)] bg-[rgba(180,35,24,0.06)] p-4 text-sm text-[var(--graphite)]">
              <p>{error.message || "The request could not be submitted."}</p>
              {error.suggestion && (
                <p className="mt-2 text-[var(--destructive)]">{error.suggestion}</p>
              )}
            </div>
          )}

          {requestsOpen &&
            prompt.trim().length > 0 &&
            prompt.trim().length < 10 && (
              <p className="text-center text-sm text-[var(--mid-gray)] sm:text-left">
                Add a little more detail — at least 10 characters.
              </p>
            )}

          {requestsOpen &&
            prompt.trim().length >= 10 &&
            requesterName.trim().length === 0 && (
              <p className="text-center text-sm text-[var(--mid-gray)] sm:text-left">
                Add your name to send a request.
              </p>
            )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="btn-primary inline-flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] px-6 text-base active:scale-[0.99] sm:h-12"
          >
            {isSubmitting ? (
              <Disc3 className="animate-spin" size={18} />
            ) : (
              <Send size={18} />
            )}
            Send request
          </button>
        </div>
      </form>
    </main>
  );
}
