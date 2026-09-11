// Barrel for the DB query layer. Split out of the former 1751-line queries.ts
// into domain modules; the public surface (@/lib/db, @/lib/db/queries) is
// unchanged. Shared internal helpers live in ./internal and are not re-exported
// except for the few that were already public.
export type { SongRequestRecord, HostSession } from "./internal";
export { requireSessionByCode, requireActiveSessionByCode } from "./internal";

export * from "./users";
export * from "./sessions";
export * from "./settings";
export * from "./station-ids";
export * from "./autodj";
export * from "./playback";
export * from "./requests";
export * from "./generation-lifecycle";
export * from "./integrations";
export * from "./external-sessions";
export * from "./player-devices";
export * from "./room-playback";
export * from "./room-operators";
export * from "./offsite-operator";
export * from "./offsite-admin";
