"use client";

import { useEffect } from "react";
import { Download, X } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import type { QueueItem } from "@/lib/status";

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "track";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function TrackDetailModal({
  item,
  onClose,
}: {
  item: QueueItem | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);

  if (!item) return null;

  const download = async () => {
    if (!item.audioUrl) return;
    try {
      const res = await fetch(item.audioUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slugify(item.prompt)}.mp3`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* best-effort */
    }
  };

  const hasLyrics = !!item.lyrics?.sections?.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div className="card relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--light-gray)] p-5">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <StatusBadge status={item.status} />
              {item.isExplicit && (
                <span className="rounded bg-[var(--graphite)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white">
                  Explicit
                </span>
              )}
            </div>
            <h2
              className="text-lg leading-snug text-[var(--graphite)]"
              style={{ fontFamily: "var(--font-brand)" }}
            >
              {item.title || item.prompt}
            </h2>
            {item.title && (
              <p className="mt-1 truncate text-sm text-[var(--mid-gray)]">
                {item.prompt}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost inline-flex size-9 shrink-0 items-center justify-center"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="eyebrow">Requested by</dt>
              <dd className="mt-1 text-[var(--graphite)]">
                {item.requesterName || "Anonymous"}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Added</dt>
              <dd className="mt-1 text-[var(--graphite)]">
                {formatDate(item.createdAt)}
              </dd>
            </div>
            {item.position != null && (
              <div>
                <dt className="eyebrow">Position</dt>
                <dd className="mono mt-1 text-[var(--graphite)]">
                  #{item.position}
                </dd>
              </div>
            )}
          </dl>

          {item.audioUrl && (
            <audio className="mt-4 w-full" controls src={item.audioUrl}>
              <track kind="captions" />
            </audio>
          )}

          <div className="mt-5">
            <p className="eyebrow mb-2">Lyrics</p>
            {hasLyrics ? (
              <div className="space-y-4">
                {item.lyrics!.sections.map((section, si) => (
                  <div key={si}>
                    {section.name && (
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--mid-gray)]">
                        {section.name}
                      </p>
                    )}
                    <div className="mt-1 space-y-0.5">
                      {section.lines.map((line, li) => (
                        <p
                          key={li}
                          className="text-sm leading-6 text-[var(--graphite)]"
                        >
                          {line.text}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--mid-gray)]">
                Instrumental — no lyrics.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        {item.audioUrl && (
          <div className="border-t border-[var(--light-gray)] p-4">
            <button
              type="button"
              onClick={download}
              className="btn-ghost inline-flex h-10 items-center gap-2 px-4 text-sm"
            >
              <Download size={15} />
              Download
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
