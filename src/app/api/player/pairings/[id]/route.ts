import { json, route } from "@/lib/api";
import { getPlayerPairingStatus } from "@/lib/db";
import {
  clearPlayerCookieOptions,
  playerCookieOptions,
} from "@/lib/auth/player";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Poll pairing status. Pass `?secret=` until approved; on approval sets the player cookie. */
export const GET = route(async (request: Request, context: Ctx) => {
  const { id } = await context.params;
  const secret = new URL(request.url).searchParams.get("secret");
  if (!secret) {
    throw new AppError(400, "missing_secret", "Pairing secret is required.");
  }

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
