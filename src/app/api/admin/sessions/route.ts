import { z } from "zod";

import { assertAdmin } from "@/lib/admin-auth";
import { createSession, listSessions } from "@/lib/db";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSessionSchema = z.object({
  name: z.string().max(80).optional(),
});

export async function GET(request: Request) {
  try {
    assertAdmin(request);
    const sessions = await listSessions();
    return Response.json(
      { sessions },
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

export async function POST(request: Request) {
  try {
    assertAdmin(request);

    const body = await request.json().catch(() => ({}));
    const parsed = createSessionSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new AppError(400, "invalid_request", "Invalid session payload.");
    }

    const session = await createSession(parsed.data.name);

    return Response.json(
      { ok: true, session },
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
