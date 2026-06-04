import { z } from "zod";

import { assertAdmin } from "@/lib/admin-auth";
import { setPlaybackState } from "@/lib/db";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const playbackSchema = z.object({
  requestId: z.string().nullable(),
  isPlaying: z.boolean(),
});

export async function POST(request: Request) {
  try {
    assertAdmin(request);

    const body = await request.json().catch(() => null);
    const parsed = playbackSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "invalid_request", "Invalid playback payload.");
    }

    await setPlaybackState(parsed.data.requestId, parsed.data.isPlaying);

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
