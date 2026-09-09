import { requireIntegrationClient } from "@/lib/auth/integration";
import { json, parseBody, route } from "@/lib/api";
import {
  requireExternalSession,
  toExternalSessionView,
  upsertExternalSession,
} from "@/lib/db";
import { hostNeedsApiKey } from "@/lib/db";
import { agendaUpsertSchema } from "@/lib/integration/contracts";
import { ensureAutoDjQueue } from "@/lib/autodj-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ externalSessionId: string }> };

export const GET = route(async (request: Request, context: Ctx) => {
  const client = await requireIntegrationClient(request);
  const { externalSessionId } = await context.params;
  const row = await requireExternalSession(client.id, externalSessionId);
  const hostKeyReady = !(await hostNeedsApiKey(row.hostId));
  return json({ session: toExternalSessionView(row, hostKeyReady) });
});

export const PUT = route(async (request: Request, context: Ctx) => {
  const client = await requireIntegrationClient(request);
  const { externalSessionId } = await context.params;
  const body = await parseBody(request, agendaUpsertSchema, {
    message: "Invalid agenda session payload.",
  });
  const session = await upsertExternalSession({
    clientId: client.id,
    ownerHostId: client.ownerHostId,
    externalSessionId,
    body,
  });

  // Pre-roll: generation takes real time, so a room that waits until it's empty
  // opens cold. Warming at the moment the agenda item goes live means there's
  // music ready when people walk in. Best-effort — never block the upsert.
  if (session.isActive && session.autoDj.enabled) {
    void ensureAutoDjQueue(session.id).catch((error) => {
      console.error("AutoDJ pre-roll failed", error);
    });
  }

  return json({ session });
});
