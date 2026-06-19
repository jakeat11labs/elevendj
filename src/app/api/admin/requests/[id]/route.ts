import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
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

export const PATCH = route(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const user = await requireHost();
    const { id } = await context.params;
    const data = await parseBody(request, actionSchema, {
      code: "invalid_admin_action",
      message: "Invalid admin action.",
    });

    if (data.action === "approve") {
      const approved = await approveRequest(user.id, id);
      if (approved) {
        await enqueueGeneration(id);
      }
    }

    if (data.action === "reject") {
      await rejectRequest(user.id, id, data.reason || "Rejected by DJ.");
    }

    if (data.action === "retry") {
      await requeueRequest(user.id, id);
      await enqueueGeneration(id);
    }

    if (data.action === "mark_played") {
      await markRequestPlayed(user.id, id);
    }

    if (data.action === "remove_from_queue") {
      await removeFromQueue(user.id, id);
    }

    if (data.action === "add_to_queue") {
      await addToQueue(user.id, id);
    }

    return json({ ok: true });
  }
);

export const DELETE = route(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const user = await requireHost();
    const { id } = await context.params;
    await deleteRequest(user.id, id);
    return json({ ok: true });
  }
);
