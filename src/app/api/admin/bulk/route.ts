import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
import { approveRequest, bulkAction } from "@/lib/db";
import { enqueueGeneration } from "@/lib/enqueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bulkSchema = z.object({
  action: z.enum(["delete", "remove_from_queue", "add_to_queue", "approve"]),
  ids: z.array(z.string().uuid()).max(200),
});

export const POST = route(async (request: Request) => {
  const user = await requireHost();
  const data = await parseBody(request, bulkSchema, {
    code: "invalid_bulk_action",
    message: "Invalid bulk action.",
  });

  // Bulk approve mirrors the per-request approve path: flip each pending
  // request to queued (host-scoped, status-gated) and kick off generation.
  if (data.action === "approve") {
    let count = 0;
    for (const id of data.ids) {
      const approved = await approveRequest(user.id, id);
      if (approved) {
        await enqueueGeneration(id);
        count += 1;
      }
    }
    return json({ ok: true, count });
  }

  const count = await bulkAction(user.id, data.action, data.ids);

  return json({ ok: true, count });
});
