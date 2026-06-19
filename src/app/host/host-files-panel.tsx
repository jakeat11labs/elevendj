"use client";

import type { Dispatch, SetStateAction } from "react";

import { Download, Plus, Trash2 } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import type { QueueItem, Session } from "@/lib/status";

import { formatDate, trackName } from "./format";
import type { BulkAction, RequestAction } from "./use-queue-actions";

/**
 * Right-column file library: session picker, bulk bar (download / add-to-queue /
 * delete / clear), and the per-file grid. Purely presentational — all data comes
 * from the files/selection/queue-action hooks via props.
 */
export function HostFilesPanel({
  files,
  filesLoading,
  filesSessionId,
  onPickSession,
  activeSession,
  sessions,
  filesSel,
  setFilesSel,
  toggle,
  downloadSelected,
  downloadFile,
  refreshFilesView,
  bulkBusy,
  busyId,
  runBulk,
  runAction,
  deleteRow,
}: {
  files: QueueItem[];
  filesLoading: boolean;
  filesSessionId: string | null;
  onPickSession: (value: string) => void;
  activeSession: Session | null;
  sessions: Session[];
  filesSel: Set<string>;
  setFilesSel: Dispatch<SetStateAction<Set<string>>>;
  toggle: (set: Set<string>, id: string) => Set<string>;
  downloadSelected: () => void;
  downloadFile: (item: QueueItem) => void;
  refreshFilesView: () => Promise<void>;
  bulkBusy: boolean;
  busyId: string | null;
  runBulk: (action: BulkAction, ids: string[]) => Promise<void>;
  runAction: (
    id: string,
    action: RequestAction,
    reason?: string
  ) => Promise<boolean>;
  deleteRow: (id: string) => Promise<void>;
}) {
  return (
    <div className="min-w-0 space-y-4 lg:col-span-3">
      {/* Files / library */}
      <section
        id="tour-files"
        className="card rise min-w-0 overflow-hidden p-4 sm:p-5"
      >
        <div className="mb-5 min-w-0 space-y-3">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-2 text-xl">
              <Download size={18} className="shrink-0" />
              Files
            </h2>
            <span className="mono shrink-0 text-sm text-[var(--mid-gray)]">
              {filesLoading ? "Loading…" : `${files.length} total`}
            </span>
          </div>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="eyebrow">Session</span>
            <select
              value={filesSessionId ?? "active"}
              onChange={(event) => onPickSession(event.target.value)}
              className="control h-10 w-full min-w-0 max-w-full px-3 text-sm"
            >
              <option value="active">
                {activeSession
                  ? `${activeSession.name} (active)`
                  : "Active session"}
              </option>
              <option value="all">All sessions</option>
              {sessions
                .filter((session) => !session.isActive)
                .map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.name}
                    {typeof session.trackCount === "number"
                      ? ` (${session.trackCount})`
                      : ""}
                  </option>
                ))}
            </select>
          </label>
        </div>

        {/* Bulk bar */}
        {filesSel.size > 0 && (
          <div className="card-soft mb-4 flex flex-wrap items-center gap-3 p-3">
            <span className="text-sm text-[var(--dark-gray)]">
              {filesSel.size} selected
            </span>
            <button
              type="button"
              onClick={downloadSelected}
              className="btn-ghost inline-flex h-9 items-center gap-2 px-4 text-sm"
            >
              <Download size={15} />
              Download selected
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={async () => {
                await runBulk("add_to_queue", [...filesSel]);
                await refreshFilesView();
                setFilesSel(new Set());
              }}
              className="btn-ghost inline-flex h-9 items-center gap-2 px-4 text-sm"
            >
              <Plus size={15} />
              Add to queue
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={async () => {
                if (
                  !window.confirm(
                    `Permanently delete ${filesSel.size} file(s)? This removes the audio and the record.`
                  )
                ) {
                  return;
                }
                await runBulk("delete", [...filesSel]);
                await refreshFilesView();
                setFilesSel(new Set());
              }}
              className="btn-danger inline-flex h-9 items-center gap-2 px-4 text-sm"
            >
              <Trash2 size={15} />
              Delete selected
            </button>
            <button
              type="button"
              onClick={() => setFilesSel(new Set())}
              className="btn-ghost inline-flex h-9 items-center gap-2 px-4 text-sm"
            >
              Clear selection
            </button>
          </div>
        )}

        <div className="space-y-2">
          {files.map((item) => (
            <div key={item.id} className="card-soft p-3.5">
              <div className="flex min-w-0 items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={filesSel.has(item.id)}
                  onChange={() => setFilesSel((prev) => toggle(prev, item.id))}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--graphite)]"
                  aria-label="Select file"
                />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium leading-snug text-[var(--graphite)]">
                    {trackName(item)}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-[var(--mid-gray)]">
                    {item.requesterName ?? "Anonymous"}
                    <span className="mono">
                      {" · "}
                      {formatDate(item.createdAt)}
                    </span>
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--light-gray)] pt-2.5">
                <StatusBadge status={item.status} />
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => downloadFile(item)}
                    disabled={!item.audioUrl}
                    className="btn-ghost inline-flex size-8 shrink-0 items-center justify-center"
                    title="Download"
                    aria-label="Download"
                  >
                    <Download size={15} />
                  </button>
                  {item.status !== "ready" && (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={async () => {
                        await runAction(item.id, "add_to_queue");
                        await refreshFilesView();
                      }}
                      className="btn-ghost inline-flex size-8 shrink-0 items-center justify-center"
                      title="Add to queue"
                      aria-label="Add to queue"
                    >
                      <Plus size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={async () => {
                      if (
                        window.confirm(
                          "Permanently delete this file? This removes the audio and the record."
                        )
                      ) {
                        await deleteRow(item.id);
                        await refreshFilesView();
                      }
                    }}
                    className="btn-danger inline-flex size-8 shrink-0 items-center justify-center"
                    title="Delete"
                    aria-label="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {files.length === 0 && (
            <p className="py-8 text-center text-sm text-[var(--mid-gray)]">
              No files yet.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
