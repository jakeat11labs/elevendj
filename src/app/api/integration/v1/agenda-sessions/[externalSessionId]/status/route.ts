import { requireIntegrationClient } from "@/lib/auth/integration";
import { json, route } from "@/lib/api";
import { getExternalSessionStatus } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ externalSessionId: string }> };

export const GET = route(async (request: Request, context: Ctx) => {
  const client = await requireIntegrationClient(request);
  const { externalSessionId } = await context.params;
  const status = await getExternalSessionStatus(client.id, externalSessionId);
  return json(status);
});
