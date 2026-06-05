import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import { activateSession, deleteSession, renameSession } from "@/lib/db";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    activate: z.literal(true).optional(),
  })
  .refine((data) => data.name !== undefined || data.activate === true, {
    message: "Nothing to update.",
  });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireHost();
    const { id } = await context.params;

    const body = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "invalid_request", "Invalid session update.");
    }

    // Rename first (if requested), then activate, so the response reflects both.
    let session = parsed.data.name
      ? await renameSession(user.id, id, parsed.data.name)
      : null;
    if (parsed.data.activate) {
      session = await activateSession(user.id, id);
    }

    return Response.json(
      { ok: true, session },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireHost();
    const { id } = await context.params;
    await deleteSession(user.id, id);
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
