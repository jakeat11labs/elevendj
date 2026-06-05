import { createSongRequest, requireSessionByCode } from "@/lib/db";
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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    // The request link carries a session `code`; requests attach to that host's
    // session. Accept it from the body or the query string.
    const url = new URL(request.url);
    const code =
      (body && typeof body === "object" && "code" in body
        ? String((body as { code?: unknown }).code ?? "")
        : "") || (url.searchParams.get("code") ?? "");
    if (!code) {
      throw new AppError(400, "missing_code", "This request link is missing its session code.");
    }
    const session = await requireSessionByCode(code);

    const input = parseRequestBody(body);
    assertPromptAllowed(input.prompt);

    const ipHash = hashValue(clientIpFromRequest(request), "ip");
    const { request: songRequest, clientToken } = await createSongRequest(
      session.id,
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
