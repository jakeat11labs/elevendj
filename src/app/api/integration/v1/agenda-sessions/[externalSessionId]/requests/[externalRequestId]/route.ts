import { and, eq } from "drizzle-orm";

import { requireIntegrationClient } from "@/lib/auth/integration";
import { json, route } from "@/lib/api";
import { db } from "@/lib/db/client";
import { requireExternalSession } from "@/lib/db";
import { songRequests } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { mapQueueItem } from "@/lib/db/queries/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = {
  params: Promise<{ externalSessionId: string; externalRequestId: string }>;
};

export const GET = route(async (request: Request, context: Ctx) => {
  const client = await requireIntegrationClient(request);
  const { externalSessionId, externalRequestId } = await context.params;
  const session = await requireExternalSession(client.id, externalSessionId);

  const [row] = await db
    .select()
    .from(songRequests)
    .where(
      and(
        eq(songRequests.sessionId, session.id),
        eq(songRequests.integrationClientId, client.id),
        eq(songRequests.externalRequestId, externalRequestId)
      )
    )
    .limit(1);

  if (!row) {
    throw new AppError(404, "request_not_found", "Request not found.");
  }

  const item = mapQueueItem(row);
  return json({
    request: {
      id: item.id,
      externalRequestId: row.externalRequestId,
      status: item.status,
      prompt: item.prompt,
      requesterName: item.requesterName,
      title: item.title,
      audioUrl: item.audioUrl,
      queuePosition: item.position,
      errorMessage: item.errorMessage,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    },
  });
});
