"use client";

import { Check, Inbox, X } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import type { QueueItem } from "@/lib/status";

import { formatDate } from "./format";

/**
 * Pending-approval panel. The wrapper is always rendered so the onboarding tour
 * has a stable anchor (`#tour-approvals`) even when the panel itself is hidden;
 * the panel shows in approval mode (`!autoApprove`) or whenever anything is
 * waiting. Purely presentational — actions come from props.
 */
export function PendingApprovalsPanel({
  pendingItems,
  autoApprove,
  bulkBusy,
  busyId,
  onApprove,
  onReject,
  onApproveAll,
}: {
  pendingItems: QueueItem[];
  autoApprove: boolean;
  bulkBusy: boolean;
  busyId: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onApproveAll: (ids: string[]) => void;
}) {
  return (
    <div id="tour-approvals">
      {(!autoApprove || pendingItems.length > 0) && (
        <section className="card rise p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-xl">
              <Inbox size={18} />
              Pending approval
              <span className="mono text-sm font-normal text-[var(--mid-gray)]">
                {pendingItems.length}
              </span>
            </h2>
            {pendingItems.length > 0 && (
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => onApproveAll(pendingItems.map((item) => item.id))}
                className="btn-primary inline-flex h-9 items-center gap-2 px-4 text-sm"
                title="Approve every pending request"
              >
                <Check size={15} />
                {bulkBusy
                  ? "Approving…"
                  : `Approve all (${pendingItems.length})`}
              </button>
            )}
          </div>
          <div className="space-y-2.5">
            {pendingItems.map((item) => (
              <div key={item.id} className="card-soft p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm leading-6 text-[var(--graphite)]">
                      {item.prompt}
                    </p>
                    <p className="mt-1 text-xs text-[var(--dark-gray)]">
                      {item.requesterName
                        ? `From ${item.requesterName}`
                        : "Anonymous"}
                      <span className="mono text-[var(--mid-gray)]">
                        {" · "}
                        {formatDate(item.createdAt)}
                      </span>
                    </p>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => onApprove(item.id)}
                    className="btn-primary inline-flex h-9 items-center gap-2 px-4 text-sm"
                  >
                    <Check size={15} />
                    Approve &amp; generate
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => onReject(item.id)}
                    className="btn-ghost inline-flex h-9 items-center gap-2 px-4 text-sm"
                  >
                    <X size={15} />
                    Reject
                  </button>
                </div>
              </div>
            ))}
            {pendingItems.length === 0 && (
              <p className="py-8 text-center text-sm text-[var(--mid-gray)]">
                Nothing waiting. New requests appear here for approval.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
