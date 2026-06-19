import { requireHost } from "@/lib/auth/admin";
import { getActiveSessionForHost, getAdminOverview } from "@/lib/db";
import { errorResponse } from "@/lib/errors";
import { STATION_ID_POOL_TARGET } from "@/lib/station-id";
import { ensureStationIdPool } from "@/lib/station-id-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
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

    return Response.json(overview, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
