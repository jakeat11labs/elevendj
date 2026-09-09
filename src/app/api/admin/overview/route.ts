import { requireHost } from "@/lib/auth/admin";
import { json, route } from "@/lib/api";
import { getActiveSessionForHost, getAdminOverview } from "@/lib/db";
import { STATION_ID_POOL_TARGET } from "@/lib/station-id";
import { ensureStationIdPool } from "@/lib/station-id-pool";
import { ensureAutoDjQueue } from "@/lib/autodj-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await requireHost();
  const overview = await getAdminOverview(user.id);

  // Backstop: while the host console polls this, keep the warm pool topped up
  // so it survives a full set even if a stage's best-effort consume call
  // never lands. Best-effort and non-blocking.
  if (
    overview.queue.stationIdEnabled &&
    overview.queue.stationIds.length < STATION_ID_POOL_TARGET
  ) {
    const active = await getActiveSessionForHost(user.id);
    void ensureStationIdPool(active.id).catch((error) => {
      console.error("Station ID pool backstop failed", error);
    });
  }

  // Same backstop for AutoDJ: the console poll is the local room's heartbeat,
  // so top the queue up here rather than waiting for it to run dry. The pool
  // itself decides whether there's a shortfall worth generating.
  if (overview.queue.autoDjEnabled) {
    void ensureAutoDjQueue(overview.activeSession.id).catch((error) => {
      console.error("AutoDJ top-up failed", error);
    });
  }

  return json(overview);
});
