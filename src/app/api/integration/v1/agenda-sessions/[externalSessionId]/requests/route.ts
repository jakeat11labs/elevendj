import { requireIntegrationClient } from "@/lib/auth/integration";
import { json, parseBody, route } from "@/lib/api";
import {
  createSongRequest,
  hostNeedsApiKey,
  requireExternalSession,
} from "@/lib/db";
import { enqueueGeneration } from "@/lib/enqueue";
import { AppError } from "@/lib/errors";
import { integrationRequestSchema } from "@/lib/integration/contracts";
import { assertPromptAllowed, hashValue } from "@/lib/security";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ externalSessionId: string }> };

export const POST = route(async (request: Request, context: Ctx) => {
  const client = await requireIntegrationClient(request);
  const { externalSessionId } = await context.params;
  const session = await requireExternalSession(client.id, externalSessionId);

  if (!session.isActive) {
    throw new AppError(
      403,
      "session_ended",
      "This agenda session has ended and is no longer accepting requests."
    );
  }

  if (await hostNeedsApiKey(session.hostId)) {
    throw new AppError(
      403,
      "host_key_missing",
      "The Offsite owner host needs a usable ElevenLabs key before requests can generate."
    );
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 8) {
    throw new AppError(
      400,
      "missing_idempotency_key",
      "Idempotency-Key header is required (at least 8 characters)."
    );
  }

  const body = await parseBody(request, integrationRequestSchema, {
    message: "Invalid request payload.",
  });
  assertPromptAllowed(body.prompt);

  const result = await createSongRequest(
    session.id,
    {
      prompt: body.prompt,
      requesterName: body.requesterName,
      styleId: body.styleId ?? null,
      instrumental: body.instrumental,
    },
    hashValue(`integration:${client.id}`, "ip"),
    {
      asIntegration: true,
      integrationClientId: client.id,
      externalRequestId: body.externalRequestId,
      requesterAvatarUrl: body.requesterAvatarUrl ?? null,
      // Room-scoped: song_requests.idempotency_key is globally unique, so a
      // portal reusing one key across two concurrent rooms must not collide.
      idempotencyKey: hashValue(
        `${client.id}:${session.id}:${idempotencyKey}`,
        "idempotency"
      ),
    }
  );

  let worker: string | null = null;
  if (!result.replayed && result.request.status === "queued") {
    const enqueue = await enqueueGeneration(result.request.id);
    worker = enqueue?.mode ?? null;
  }

  return json(
    {
      requestId: result.request.id,
      externalRequestId: body.externalRequestId,
      status: result.request.status,
      queuePosition: result.request.position,
      replayed: result.replayed,
      worker,
    },
    { status: result.replayed ? 200 : 201 }
  );
});
