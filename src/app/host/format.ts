// Small formatting helpers shared across the host console and its extracted
// panels. Pure functions, no React.

/**
 * Display name for a track: the generated title once it exists, otherwise the
 * original prompt (e.g. while still pending/generating). Full prompt lives in
 * the track detail modal.
 */
export function trackName(item: { title: string | null; prompt: string }): string {
  return item.title?.trim() || item.prompt;
}

/** Filename-safe slug for downloads. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "track";
}

/** Compact local date/time, e.g. "Jun 19, 2:05 PM". */
export function formatDate(iso: string): string {
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
