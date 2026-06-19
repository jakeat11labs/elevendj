import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
import { createSessionForHost, listSessionsForHost } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSessionSchema = z.object({
  name: z.string().max(80).optional(),
});

export const GET = route(async () => {
  const user = await requireHost();
  const sessions = await listSessionsForHost(user.id);
  return json({ sessions });
});

export const POST = route(async (request: Request) => {
  const user = await requireHost();
  const { name } = await parseBody(request, createSessionSchema, {
    message: "Invalid session payload.",
  });
  const session = await createSessionForHost(user.id, name);
  return json({ ok: true, session });
});
