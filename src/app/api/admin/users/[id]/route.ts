import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
import { setUserAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  isAdmin: z.boolean(),
});

export const PATCH = route(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const admin = await requireAdmin();
    const { id } = await context.params;

    const { isAdmin } = await parseBody(request, patchSchema, {
      message: "Invalid user update.",
    });

    const user = await setUserAdmin(admin.id, id, isAdmin);
    return json({ ok: true, user });
  }
);
