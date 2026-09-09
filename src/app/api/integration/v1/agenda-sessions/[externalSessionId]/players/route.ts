import { requireIntegrationClient } from "@/lib/auth/integration";
import { json, parseBody, route } from "@/lib/api";
import {
  assignPlayerDevice,
  listPlayerDevicesForSession,
  requireExternalSession,
} from "@/lib/db";
import { spaceAssignmentSchema } from "@/lib/integration/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ externalSessionId: string }> };

/** Assign or unassign a physical player to this agenda session. */
export const PUT = route(async (request: Request, context: Ctx) => {
  const client = await requireIntegrationClient(request);
  const { externalSessionId } = await context.params;
  const session = await requireExternalSession(
    client.id,
    decodeURIComponent(externalSessionId)
  );

  const body = await parseBody(request, spaceAssignmentSchema, {
    message: "Invalid space assignment payload.",
  });

  const device = await assignPlayerDevice(
    body.deviceId,
    body.assign ? session.id : null
  );

  const players = await listPlayerDevicesForSession(session.id);
  return json({ device, players });
});

export const GET = route(async (request: Request, context: Ctx) => {
  const client = await requireIntegrationClient(request);
  const { externalSessionId } = await context.params;
  const session = await requireExternalSession(
    client.id,
    decodeURIComponent(externalSessionId)
  );
  const players = await listPlayerDevicesForSession(session.id);
  return json({
    externalSessionId: session.externalSessionId,
    sessionId: session.id,
    players,
  });
});
