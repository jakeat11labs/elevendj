import { z } from "zod";

import { assertAdmin } from "@/lib/admin-auth";
import { setAutoDj, setRequestsOpen } from "@/lib/db";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const settingsSchema = z
  .object({
    requestsOpen: z.boolean().optional(),
    autoDj: z.boolean().optional(),
  })
  .refine(
    (value) => value.requestsOpen !== undefined || value.autoDj !== undefined,
    { message: "No settings provided." }
  );

export async function POST(request: Request) {
  try {
    assertAdmin(request);

    const body = await request.json().catch(() => null);
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "invalid_request", "Invalid settings payload.");
    }

    if (parsed.data.requestsOpen !== undefined) {
      await setRequestsOpen(parsed.data.requestsOpen);
    }
    if (parsed.data.autoDj !== undefined) {
      await setAutoDj(parsed.data.autoDj);
    }

    return Response.json(
      {
        ok: true,
        requestsOpen: parsed.data.requestsOpen,
        autoDj: parsed.data.autoDj,
      },
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
