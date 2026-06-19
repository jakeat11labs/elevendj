import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
import { setPlaybackState } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const playbackSchema = z.object({
  requestId: z.string().nullable(),
  isPlaying: z.boolean(),
});

export const POST = route(async (request: Request) => {
  const user = await requireHost();
  const { requestId, isPlaying } = await parseBody(request, playbackSchema, {
    message: "Invalid playback payload.",
  });

  await setPlaybackState(user.id, requestId, isPlaying);

  return json({ ok: true });
});
