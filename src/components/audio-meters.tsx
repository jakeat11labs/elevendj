export function AudioMeters({ active = true }: { active?: boolean }) {
  return (
    <div
      className="meters flex h-8 items-end gap-[3px]"
      data-idle={active ? "false" : "true"}
      aria-hidden
    >
      <span className="h-8 w-[3px] rounded-full bg-[var(--graphite)]" />
      <span className="h-6 w-[3px] rounded-full bg-[var(--dark-gray)]" />
      <span className="h-8 w-[3px] rounded-full bg-[var(--graphite)]" />
      <span className="h-5 w-[3px] rounded-full bg-[var(--mid-gray)]" />
    </div>
  );
}
