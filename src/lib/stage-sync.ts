// Real-time, same-origin sync between the host console (controller) and the
// /stage player (single audio output) via BroadcastChannel.
//
// Model: when a stage is connected, the host delegates playback to it and goes
// silent; the stage is the only tab that emits audio. The host stays the
// control surface (play/pause/next/select) and mirrors the stage's state.
//
// Channels are namespaced by session publicCode so multiple local rooms in one
// browser do not cross-talk.

export function stageChannelName(publicCode?: string | null): string {
  const code = (publicCode ?? "").trim();
  return code ? `elevendj-stage:${code}` : "elevendj-stage";
}

/** @deprecated Use stageChannelName(publicCode) — kept for call-site clarity. */
export const STAGE_CHANNEL = "elevendj-stage";

export type HostAction = "play" | "pause" | "next" | "select";

export type HostCommand = {
  source: "host";
  type: "command";
  action: HostAction;
  trackId?: string | null;
};

export type StageStatusType = "hello" | "heartbeat" | "state" | "bye";

export type StageStatus = {
  source: "stage";
  type: StageStatusType;
  currentId: string | null;
  isPlaying: boolean;
};

export type StageMessage = HostCommand | StageStatus;

/** Open the channel for a session, or null when unavailable (SSR / unsupported). */
export function createStageChannel(
  publicCode?: string | null
): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  try {
    return new BroadcastChannel(stageChannelName(publicCode));
  } catch {
    return null;
  }
}

/** Validate an incoming message is a well-formed host command. */
export function asHostCommand(data: unknown): HostCommand | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.source !== "host" || m.type !== "command") return null;
  if (
    m.action !== "play" &&
    m.action !== "pause" &&
    m.action !== "next" &&
    m.action !== "select"
  ) {
    return null;
  }
  const trackId =
    typeof m.trackId === "string" || m.trackId === null
      ? (m.trackId as string | null)
      : undefined;
  return { source: "host", type: "command", action: m.action, trackId };
}

/** Validate an incoming message is a well-formed stage status. */
export function asStageStatus(data: unknown): StageStatus | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.source !== "stage") return null;
  if (
    m.type !== "hello" &&
    m.type !== "heartbeat" &&
    m.type !== "state" &&
    m.type !== "bye"
  ) {
    return null;
  }
  const currentId =
    typeof m.currentId === "string" || m.currentId === null
      ? (m.currentId as string | null)
      : null;
  return {
    source: "stage",
    type: m.type,
    currentId,
    isPlaying: Boolean(m.isPlaying),
  };
}
