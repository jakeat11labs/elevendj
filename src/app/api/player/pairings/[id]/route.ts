import { z } from "zod";

import { json, parseBody, route } from "@/lib/api";
import { getPlayerPairingStatus } from "@/lib/db";
import {
  clearPlayerCookieOptions,
  playerCookieOptions,
} from "@/lib/auth/player";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const pollSchema = z.object({ secret: z.string().min(1) });

/**
 * Poll pairing status; on approval sets the player cookie. The secret is the
 * long-lived device credential, so it rides in the body rather than the query
 * string, which would copy it into every access log on each 2s poll.
 */
export const POST = route(async (request: Request, context: Ctx) => {
  const { id } = await context.params;
  const { secret } = await parseBody(request, pollSchema, {
    message: "Pairing secret is required.",
  });

  const status = await getPlayerPairingStatus(id, secret);
  if (status.status === "approved") {
    const response = json({
      status: "approved",
      deviceId: status.deviceId,
      sessionId: status.sessionId ?? null,
    });
    // Set the HttpOnly cookie with the same secret that was registered at pairing.
    const cookie = playerCookieOptions(secret);
    response.headers.append(
      "Set-Cookie",
      [
        `${cookie.name}=${cookie.value}`,
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Strict",
        `Max-Age=${cookie.maxAge}`,
      ].join("; ")
    );
    return response;
  }

  return json({ status: status.status });
});

/** Clear cookie helper used by the unpair flow — kept here for completeness. */
export const DELETE = route(async () => {
  const response = json({ ok: true });
  const cookie = clearPlayerCookieOptions();
  response.headers.append(
    "Set-Cookie",
    [
      `${cookie.name}=`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Strict",
      "Max-Age=0",
    ].join("; ")
  );
  return response;
});
