/**
 * Shared contracts for Offsite Integration API + remote player playback.
 * Safe to import from both server and client.
 */

export type PlaybackActionName =
  | "play"
  | "pause"
  | "skip"
  | "select"
  | "ended";

export type PlaybackAction =
  | { action: "play"; expectedRevision: number }
  | { action: "pause"; expectedRevision: number }
  | { action: "skip"; expectedRevision: number }
  | {
      action: "select";
      trackId: string;
      autoplay?: boolean;
      expectedRevision: number;
    }
  | {
      action: "ended";
      trackId: string;
      expectedRevision: number;
    };

export type RoomPlaybackState = {
  sessionId: string;
  currentRequestId: string | null;
  isPlaying: boolean;
  positionMs: number;
  playbackStartedAt: string | null;
  revision: number;
  updatedAt: string | null;
  serverTime: string;
};

export type PlayerStatusReport = {
  requestId: string | null;
  revision: number;
  isPlaying: boolean;
  positionMs: number;
  audioUnlocked: boolean;
  error?: string | null;
};

export type IntegrationAgendaUpsert = {
  title: string;
  roomName?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  revision?: string | null;
  state?: "scheduled" | "live" | "ended";
  settings?: {
    requestsOpen?: boolean;
    defaultDurationMs?: number;
    forceInstrumental?: boolean;
    autoApprove?: boolean;
    autoDj?: {
      enabled?: boolean;
      target?: number;
      brief?: string | null;
      autoplay?: boolean;
    };
  };
  metadata?: Record<string, unknown>;
};

export type IntegrationRequestInput = {
  externalRequestId: string;
  prompt: string;
  requesterName: string;
  requesterAvatarUrl?: string | null;
  styleId?: string | null;
  instrumental?: boolean;
};
