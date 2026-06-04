import { z } from "zod";

import { assertAdmin } from "@/lib/admin-auth";
import { bulkAction } from "@/lib/db";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bulkSchema = z.object({
  action: z.enum(["delete", "remove_from_queue", "add_to_queue"]),
  ids: z.array(z.string().uuid()).max(200),
});

export async function POST(request: Request) {
  try {
    assertAdmin(request);
    const body = await request.json().catch(() => null);
    const parsed = bulkSchema.safeParse(body);

    if (!parsed.success) {
      throw new AppError(400, "invalid_bulk_action", "Invalid bulk action.");
    }

    const count = await bulkAction(parsed.data.action, parsed.data.ids);

    return Response.json(
      { ok: true, count },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
