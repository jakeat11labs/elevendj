import "server-only";

import type { z } from "zod";

import { AppError, errorResponse } from "@/lib/errors";

/**
 * JSON response for API routes. Defaults to `Cache-Control: no-store` because
 * every dynamic/admin endpoint here is uncacheable; pass an explicit
 * `Cache-Control` header in `init` to override.
 */
export function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
  return Response.json(data, { ...init, headers });
}

/**
 * Parse and validate a JSON request body, throwing a 400 {@link AppError} when
 * it is missing or fails the schema. A missing/unparseable body is validated as
 * `{}`, so all-optional schemas still pass (matching the prior per-route
 * `safeParse(body ?? {})` behavior) while required-field schemas still 400.
 */
export async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
  error: { code?: string; message?: string } = {}
): Promise<z.infer<S>> {
  const raw = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new AppError(
      400,
      error.code ?? "invalid_request",
      error.message ?? "Request body is invalid."
    );
  }
  return parsed.data;
}

/**
 * Wrap a route handler so thrown {@link AppError}s (and unexpected errors)
 * become the standard JSON error response — removes the repeated try/catch from
 * every route. The handler's argument signature is preserved, so Next's route
 * typing (including `{ params }`) still applies at the call site.
 */
export function route<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
