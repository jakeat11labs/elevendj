import type { RequestStatus } from "@/lib/status";

type Dot = {
  /* tailwind/utility classes applied to the state dot */
  dot: string;
  /* show a pulsing ping ring (for in-flight states) */
  pulse?: boolean;
  /* render the dot as a hollow outline instead of a fill */
  hollow?: boolean;
  /* optional override for the visible label (defaults to the status) */
  label?: string;
};

// Light monochrome brand system — state is carried by a single dot, not
// invented UI accent colours. Failures use the brand --destructive token.
const config: Record<RequestStatus, Dot> = {
  pending: { dot: "bg-[var(--light-gray)]", label: "Pending" },
  queued: { dot: "bg-[var(--mid-gray)]" },
  generating: { dot: "bg-[var(--graphite)]", pulse: true },
  ready: {
    dot: "bg-[var(--graphite)] shadow-[0_0_8px_1px_rgba(30,25,22,0.35)]",
  },
  rejected: { dot: "bg-[var(--destructive)]" },
  failed: { dot: "bg-[var(--destructive)]" },
  played: { dot: "bg-[var(--light-gray)]", label: "Played" },
  archived: {
    dot: "bg-transparent border border-[var(--mid-gray)]",
    hollow: true,
    label: "Archived",
  },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const { dot, pulse, label } = config[status];
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--light-gray)] bg-[var(--white)] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--graphite)]">
      <span className="relative grid size-1.5 place-items-center">
        <span className={`size-1.5 rounded-full ${dot}`} />
        {pulse && (
          <span className="absolute size-1.5 animate-ping rounded-full bg-[var(--graphite)]/60" />
        )}
      </span>
      {label ?? status}
    </span>
  );
}
