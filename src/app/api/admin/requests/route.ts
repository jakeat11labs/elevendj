import { requireHost } from "@/lib/auth/admin";
import {
  createSongRequest,
  getActiveSessionForHost,
  hostNeedsApiKey,
} from "@/lib/db";
import { enqueueGeneration } from "@/lib/enqueue";
import { AppError, errorResponse } from "@/lib/errors";
import {
  assertPromptAllowed,
  clientIpFromRequest,
  hashValue,
  parseRequestBody,
} from "@/lib/security";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Host-authored request. The DJ spins a track straight into their active
 * session's live queue — same validation as the public form, but host-only and
 * implicitly approved (always `queued`, regardless of approval mode or the
 * request line being paused).
 */
export async function POST(request: Request) {
  try {
    const user = await requireHost();

    if (await hostNeedsApiKey(user.id)) {
      throw new AppError(
        403,
        "host_key_missing",
        "Connect your ElevenLabs API key before generating tracks."
      );
    }

    const active = await getActiveSessionForHost(user.id);

    const body = await request.json().catch(() => null);
    const input = parseRequestBody(body);
    assertPromptAllowed(input.prompt);

    const ipHash = hashValue(clientIpFromRequest(request), "ip");
    const { request: songRequest, clientToken } = await createSongRequest(
      active.id,
      input,
      ipHash,
      { asHost: true }
    );

    const enqueue = await enqueueGeneration(songRequest.id);

    return Response.json(
      {
        requestId: songRequest.id,
        clientToken,
        status: songRequest.status,
        queuePosition: songRequest.position,
        worker: enqueue?.mode ?? null,
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
