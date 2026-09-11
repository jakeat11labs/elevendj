import { z } from "zod";

import {
  clearRoomOperatorCookie,
  requireSameOrigin,
  roomOperatorCookie,
} from "@/lib/auth/room-operator";
import { json, parseBody, route } from "@/lib/api";
import { exchangeRoomOperatorLink } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  clientIpFromRequest,
  hashValue,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const accessSchema = z.object({
  token: z.string().trim().min(40).max(300),
  pin: z.string().regex(/^\d{8}$/),
});

function setCookieHeader(cookie: ReturnType<typeof roomOperatorCookie>) {
  return [
    `${cookie.name}=${cookie.value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${cookie.maxAge}`,
  ].join("; ");
}

/**
 * Exchange the high-entropy URL-fragment secret for an HttpOnly cookie. The
 * fragment never reaches a request URL, proxy, browser history entry, or log.
 */
export const POST = route(async (request: Request) => {
  requireSameOrigin(request);
  const { token, pin } = await parseBody(request, accessSchema, {
    message: "Invalid room-control link.",
  });
  const session = await exchangeRoomOperatorLink({
    token,
    pin,
    ipHash: hashValue(clientIpFromRequest(request), "room-operator-ip"),
    userAgentHash: hashValue(
      request.headers.get("user-agent") || "unknown",
      "room-operator-agent"
    ),
  });
  if (!session) {
    throw new AppError(
      401,
      "invalid_room_link",
      "The room-control link or PIN is invalid, expired, or temporarily locked."
    );
  }

  const maxAge = Math.max(
    0,
    Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)
  );
  const response = json({ ok: true, sessionId: session.sessionId });
  response.headers.append(
    "Set-Cookie",
    setCookieHeader(roomOperatorCookie(session.secret, maxAge))
  );
  return response;
});

export const DELETE = route(async (request: Request) => {
  requireSameOrigin(request);
  const response = json({ ok: true });
  response.headers.append(
    "Set-Cookie",
    setCookieHeader(clearRoomOperatorCookie())
  );
  return response;
});
