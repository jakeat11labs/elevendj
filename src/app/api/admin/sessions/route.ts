import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import { createSessionForHost, listSessionsForHost } from "@/lib/db";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSessionSchema = z.object({
  name: z.string().max(80).optional(),
});

export async function GET() {
  try {
    const user = await requireHost();
    const sessions = await listSessionsForHost(user.id);
    return Response.json(
      { sessions },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireHost();

    const body = await request.json().catch(() => ({}));
    const parsed = createSessionSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new AppError(400, "invalid_request", "Invalid session payload.");
    }

    const session = await createSessionForHost(user.id, parsed.data.name);

    return Response.json(
      { ok: true, session },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
