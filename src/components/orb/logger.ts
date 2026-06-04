/**
 * Minimal logger for the orb module. Mirrors the small surface used by the
 * ported files (warn/error/info) without pulling in the source project's
 * logging utility.
 */
export const logger = {
  warn: (...args: unknown[]) => console.warn("[Orb]", ...args),
  error: (...args: unknown[]) => console.error("[Orb]", ...args),
  info: (...args: unknown[]) => console.info("[Orb]", ...args),
};
