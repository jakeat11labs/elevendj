import "server-only";

import { AppError } from "@/lib/errors";
import { optionalEnv } from "@/lib/env";

export function assertAdmin(request: Request) {
  const expected = optionalEnv("ADMIN_ACCESS_TOKEN");
  if (!expected) {
    throw new AppError(
      503,
      "admin_not_configured",
      "ADMIN_ACCESS_TOKEN must be configured before using admin actions."
    );
  }

  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");

  if (bearer !== expected && queryToken !== expected) {
    throw new AppError(401, "unauthorized", "Admin token required.");
  }
}
