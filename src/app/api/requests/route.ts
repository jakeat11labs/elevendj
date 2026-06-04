import { enqueueGeneration } from "@/lib/enqueue";
import { errorResponse } from "@/lib/errors";
import {
  assertPromptAllowed,
  clientIpFromRequest,
  hashValue,
  parseRequestBody,
} from "@/lib/security";
import { createSongRequest } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const input = parseRequestBody(body);
    assertPromptAllowed(input.prompt);

    const ipHash = hashValue(clientIpFromRequest(request), "ip");
    const { request: songRequest, clientToken } = await createSongRequest(
      input,
      ipHash
    );

    // In approval mode the request lands as `pending`; the host approves it
    // later, which is what triggers generation. Only auto-generate `queued`.
    const enqueue =
      songRequest.status === "queued"
        ? await enqueueGeneration(songRequest.id)
        : null;

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
