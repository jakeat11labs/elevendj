import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import {
  addToQueue,
  approveRequest,
  deleteRequest,
  markRequestPlayed,
  rejectRequest,
  removeFromQueue,
  requeueRequest,
} from "@/lib/db";
import { enqueueGeneration } from "@/lib/enqueue";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";

const actionSchema = z.object({
  action: z.enum([
    "approve",
    "reject",
    "retry",
    "mark_played",
    "remove_from_queue",
    "add_to_queue",
  ]),
  reason: z.string().trim().max(200).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireHost();
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const parsed = actionSchema.safeParse(body);

    if (!parsed.success) {
      throw new AppError(400, "invalid_admin_action", "Invalid admin action.");
    }

    if (parsed.data.action === "approve") {
      const approved = await approveRequest(user.id, id);
      if (approved) {
        await enqueueGeneration(id);
      }
    }

    if (parsed.data.action === "reject") {
      await rejectRequest(user.id, id, parsed.data.reason || "Rejected by DJ.");
    }

    if (parsed.data.action === "retry") {
      await requeueRequest(user.id, id);
      await enqueueGeneration(id);
    }

    if (parsed.data.action === "mark_played") {
      await markRequestPlayed(user.id, id);
    }

    if (parsed.data.action === "remove_from_queue") {
      await removeFromQueue(user.id, id);
    }

    if (parsed.data.action === "add_to_queue") {
      await addToQueue(user.id, id);
    }

    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireHost();
    const { id } = await context.params;
    await deleteRequest(user.id, id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
