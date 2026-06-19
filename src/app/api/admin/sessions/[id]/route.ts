import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
import { activateSession, deleteSession, renameSession } from "@/lib/db";

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

export const PATCH = route(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const user = await requireHost();
    const { id } = await context.params;

    const data = await parseBody(request, patchSchema, {
      message: "Invalid session update.",
    });

    // Rename first (if requested), then activate, so the response reflects both.
    let session = data.name
      ? await renameSession(user.id, id, data.name)
      : null;
    if (data.activate) {
      session = await activateSession(user.id, id);
    }

    return json({ ok: true, session });
  }
);

export const DELETE = route(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const user = await requireHost();
    const { id } = await context.params;
    await deleteSession(user.id, id);
    return json({ ok: true });
  }
);
