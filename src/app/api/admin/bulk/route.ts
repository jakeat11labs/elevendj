import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import { approveRequest, bulkAction } from "@/lib/db";
import { enqueueGeneration } from "@/lib/enqueue";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bulkSchema = z.object({
  action: z.enum(["delete", "remove_from_queue", "add_to_queue", "approve"]),
  ids: z.array(z.string().uuid()).max(200),
});

export async function POST(request: Request) {
  try {
    const user = await requireHost();
    const body = await request.json().catch(() => null);
    const parsed = bulkSchema.safeParse(body);

    if (!parsed.success) {
      throw new AppError(400, "invalid_bulk_action", "Invalid bulk action.");
    }

    // Bulk approve mirrors the per-request approve path: flip each pending
    // request to queued (host-scoped, status-gated) and kick off generation.
    if (parsed.data.action === "approve") {
      let count = 0;
      for (const id of parsed.data.ids) {
        const approved = await approveRequest(user.id, id);
        if (approved) {
          await enqueueGeneration(id);
          count += 1;
        }
      }
      return Response.json(
        { ok: true, count },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const count = await bulkAction(user.id, parsed.data.action, parsed.data.ids);

    return Response.json(
      { ok: true, count },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
