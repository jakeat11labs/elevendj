import { z } from "zod";

import { assertAdmin } from "@/lib/admin-auth";
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
    assertAdmin(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const parsed = actionSchema.safeParse(body);

    if (!parsed.success) {
      throw new AppError(400, "invalid_admin_action", "Invalid admin action.");
    }

    if (parsed.data.action === "approve") {
      const approved = await approveRequest(id);
      if (approved) {
        await enqueueGeneration(id);
      }
    }

    if (parsed.data.action === "reject") {
      await rejectRequest(id, parsed.data.reason || "Rejected by DJ.");
    }

    if (parsed.data.action === "retry") {
      await requeueRequest(id);
      await enqueueGeneration(id);
    }

    if (parsed.data.action === "mark_played") {
      await markRequestPlayed(id);
    }

    if (parsed.data.action === "remove_from_queue") {
      await removeFromQueue(id);
    }

    if (parsed.data.action === "add_to_queue") {
      await addToQueue(id);
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
    assertAdmin(request);
    const { id } = await context.params;
    await deleteRequest(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
