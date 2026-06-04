import "server-only";

import { timingSafeEqual } from "crypto";

import { AppError } from "@/lib/errors";
import { optionalEnv } from "@/lib/env";

/** Constant-time string compare to avoid leaking the token via timing. */
function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function assertAdmin(request: Request) {
  const expected = optionalEnv("ADMIN_ACCESS_TOKEN");
  if (!expected) {
    throw new AppError(
      503,
      "admin_not_configured",
      "ADMIN_ACCESS_TOKEN must be configured before using admin actions."
    );
  }

  // Accept the admin token via the Authorization header only — never the query
  // string (tokens in URLs leak into logs, proxies, and Referer headers).
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (!bearer || !safeEqual(bearer, expected)) {
    throw new AppError(401, "unauthorized", "Admin token required.");
  }
}
