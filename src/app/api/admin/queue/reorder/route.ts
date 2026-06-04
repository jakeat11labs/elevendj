import { z } from "zod";

import { assertAdmin } from "@/lib/admin-auth";
import { reorderQueue } from "@/lib/db";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()).max(200),
});

export async function POST(request: Request) {
  try {
    assertAdmin(request);
    const body = await request.json().catch(() => null);
    const parsed = reorderSchema.safeParse(body);

    if (!parsed.success) {
      throw new AppError(400, "invalid_reorder", "Invalid reorder payload.");
    }

    await reorderQueue(parsed.data.orderedIds);

    return Response.json(
      { ok: true },
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
