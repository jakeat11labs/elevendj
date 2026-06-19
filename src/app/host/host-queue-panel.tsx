"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

import { GripVertical, ListMusic, Play, Radio, X } from "lucide-react";

import { AudioMeters } from "@/components/audio-meters";
import type { QueueItem } from "@/lib/status";

import { trackName } from "./format";
import type { BulkAction, RequestAction } from "./use-queue-actions";

/**
 * Live queue panel: bulk bar, drag-to-reorder song rows, and the interleaved
 * read-only Radio-ID markers. Drag interaction state (dragId/overId) is local
 * to this panel; everything else (queue data, selection, playback actions) comes
 * from props. The row Play button's stage-delegation gate is encapsulated in the
 * parent's `onPlayItem`.
 */
export function HostQueuePanel({
  readyItems,
  displayItems,
  current,
  activeStationId,
  isPlaying,
  reordering,
  queueSel,
  setQueueSel,
  toggle,
  bulkBusy,
  busyId,
  runBulk,
  runAction,
  onReorder,
  onPlayItem,
  onPlayStationId,
  onOpenDetail,
}: {
  readyItems: QueueItem[];
  displayItems: QueueItem[];
  current: QueueItem | null;
  activeStationId: QueueItem | null;
  isPlaying: boolean;
  reordering: boolean;
  queueSel: Set<string>;
  setQueueSel: Dispatch<SetStateAction<Set<string>>>;
  toggle: (set: Set<string>, id: string) => Set<string>;
  bulkBusy: boolean;
  busyId: string | null;
  runBulk: (action: BulkAction, ids: string[]) => Promise<void>;
  runAction: (
    id: string,
    action: RequestAction,
    reason?: string
  ) => Promise<boolean>;
  onReorder: (orderedIds: string[]) => Promise<void>;
  onPlayItem: (id: string) => void;
  onPlayStationId: (item: QueueItem) => void;
  onOpenDetail: (item: QueueItem) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  function dropOnto(targetId: string) {
    const sourceId = dragId;
    setDragId(null);
    setOverId(null);
    if (!sourceId || sourceId === targetId) {
      return;
    }
    const ids = readyItems.map((item) => item.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) {
      return;
    }
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void onReorder(next);
  }

  return (
    <section id="tour-queue" className="card rise p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ListMusic size={16} />
          Queue
          <span className="mono text-xs font-normal text-[var(--mid-gray)]">
            {readyItems.length}
          </span>
        </h2>
        <span className="text-xs text-[var(--mid-gray)]">drag to reorder</span>
      </div>

      {/* Bulk bar */}
      {queueSel.size > 0 && (
        <div className="card-soft mb-4 flex flex-wrap items-center gap-3 p-3">
          <span className="text-sm text-[var(--dark-gray)]">
            {queueSel.size} selected
          </span>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={async () => {
              await runBulk("remove_from_queue", [...queueSel]);
              setQueueSel(new Set());
            }}
            className="btn-ghost inline-flex h-9 items-center gap-2 px-4 text-sm"
          >
            <X size={15} />
            Remove from queue
          </button>
          <button
            type="button"
            onClick={() => setQueueSel(new Set())}
            className="btn-ghost inline-flex h-9 items-center gap-2 px-4 text-sm"
          >
            Clear selection
          </button>
        </div>
      )}

      <div className={`space-y-1.5 ${reordering ? "opacity-60" : ""}`}>
        {displayItems.map((item, i) => {
          // Interleaved radio-ID jingle — read-only marker showing where it'll
          // drop in. Not draggable, selectable, or removable (it's virtual).
          if (item.kind === "station_id") {
            return (
              <div
                key={item.id}
                className={`flex items-center gap-2.5 rounded-md border border-dashed px-2.5 py-1.5 ${
                  activeStationId?.id === item.id
                    ? "border-[var(--graphite)] bg-[var(--graphite)]/[0.06]"
                    : "border-[var(--mid-gray)]/40 bg-[var(--graphite)]/[0.03]"
                }`}
              >
                <Radio
                  size={14}
                  className={`shrink-0 ${
                    activeStationId?.id === item.id
                      ? "text-[var(--graphite)]"
                      : "text-[var(--mid-gray)]"
                  }`}
                  aria-hidden
                />
                <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-[var(--mid-gray)]">
                  Radio ID
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--mid-gray)]">
                  {item.title && item.title !== "Radio ID"
                    ? item.title
                    : "Station jingle"}
                </span>
                {activeStationId?.id === item.id && (
                  <span className="shrink-0">
                    <AudioMeters active={isPlaying} />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onPlayStationId(item)}
                  className="btn-primary inline-flex size-8 shrink-0 items-center justify-center"
                  title="Play this Radio ID now"
                >
                  <Play size={14} />
                </button>
              </div>
            );
          }
          // Song rows keep their real-queue ordinal (jingles don't count).
          const index = displayItems
            .slice(0, i)
            .filter((x) => x.kind !== "station_id").length;
          const isCurrent = item.id === current?.id;
          const isOver = !!dragId && dragId !== item.id && overId === item.id;
          const isDragging = dragId === item.id;
          return (
            <div
              key={item.id}
              draggable
              onDragStart={(event) => {
                setDragId(item.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (overId !== item.id) setOverId(item.id);
              }}
              onDragLeave={() => {
                if (overId === item.id) setOverId(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                dropOnto(item.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              className={`card-soft flex items-center gap-2.5 px-2.5 py-2 transition ${
                isCurrent ? "border-[var(--graphite)]" : ""
              } ${isOver ? "ring-2 ring-[var(--graphite)]" : ""} ${
                isDragging ? "opacity-40" : ""
              }`}
            >
              <GripVertical
                size={15}
                className="shrink-0 cursor-grab text-[var(--mid-gray)] active:cursor-grabbing"
                aria-hidden
              />
              <input
                type="checkbox"
                checked={queueSel.has(item.id)}
                onChange={() => setQueueSel((prev) => toggle(prev, item.id))}
                className="size-4 shrink-0 accent-[var(--graphite)]"
                aria-label="Select queue item"
              />
              <span className="mono w-5 shrink-0 text-xs text-[var(--mid-gray)]">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onOpenDetail(item)}
                  className="block w-full truncate text-left text-sm text-[var(--graphite)] hover:underline"
                  title="View details"
                >
                  {trackName(item)}
                </button>
                <p className="truncate text-xs text-[var(--mid-gray)]">
                  {item.requesterName
                    ? `Generated by ${item.requesterName}`
                    : "Anonymous"}
                </p>
              </div>
              {isCurrent && (
                <span className="mr-0.5 hidden shrink-0 sm:block">
                  <AudioMeters active={isPlaying} />
                </span>
              )}
              <button
                type="button"
                onClick={() => onPlayItem(item.id)}
                className="btn-primary inline-flex size-8 shrink-0 items-center justify-center"
                title="Play this"
              >
                <Play size={14} />
              </button>
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => runAction(item.id, "remove_from_queue")}
                className="btn-ghost inline-flex size-8 shrink-0 items-center justify-center"
                title="Remove from queue"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
        {readyItems.length === 0 && (
          <p className="py-8 text-center text-sm text-[var(--mid-gray)]">
            No ready tracks in the queue yet.
          </p>
        )}
      </div>
    </section>
  );
}
