import { z } from "zod";
import {
  requireRoomOperatorAccess,
  requireSameOrigin,
} from "@/lib/auth/room-operator";
import { json, parseBody, route } from "@/lib/api";
import { reorderOffsiteQueue } from "@/lib/db";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sessionId: string }> };

const reorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()).max(200),
});

export const POST = route(async (request: Request, context: Ctx) => {
  requireSameOrigin(request);
  const { sessionId } = await context.params;
  await requireRoomOperatorAccess(sessionId);
  const { orderedIds } = await parseBody(request, reorderSchema, {
    message: "Invalid queue order.",
  });
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new AppError(
      400,
      "duplicate_track",
      "A track appears more than once in the queue order."
    );
  }

  await reorderOffsiteQueue(sessionId, orderedIds);
  return json({ ok: true });
});
