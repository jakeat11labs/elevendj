import { requireIntegrationClient } from "@/lib/auth/integration";
import { json, parseBody, route } from "@/lib/api";
import { applyPlaybackAction, requireExternalSession } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { playbackActionSchema } from "@/lib/integration/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ externalSessionId: string }> };

export const POST = route(async (request: Request, context: Ctx) => {
  const client = await requireIntegrationClient(request);
  const { externalSessionId } = await context.params;
  const session = await requireExternalSession(client.id, externalSessionId);

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 8) {
    throw new AppError(
      400,
      "missing_idempotency_key",
      "Idempotency-Key header is required (at least 8 characters)."
    );
  }

  const action = await parseBody(request, playbackActionSchema, {
    message: "Invalid playback action.",
  });

  const playback = await applyPlaybackAction(
    session.id,
    {
      type: "integration",
      id: client.id,
      idempotencyKey,
    },
    action
  );

  return json({ playback });
});
