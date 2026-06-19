import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
import { reorderQueue } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()).max(200),
});

export const POST = route(async (request: Request) => {
  const user = await requireHost();
  const { orderedIds } = await parseBody(request, reorderSchema, {
    code: "invalid_reorder",
    message: "Invalid reorder payload.",
  });

  await reorderQueue(user.id, orderedIds);

  return json({ ok: true });
});
