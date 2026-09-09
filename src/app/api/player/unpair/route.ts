import { requirePlayerDevice } from "@/lib/auth/player";
import { clearPlayerCookieOptions } from "@/lib/auth/player";
import { json, route } from "@/lib/api";
import { revokePlayerDevice } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async () => {
  const device = await requirePlayerDevice();
  await revokePlayerDevice(device.id);
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
