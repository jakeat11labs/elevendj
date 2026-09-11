export type ProviderError = {
  code: string;
  message: string;
  suggestion?: string;
};

type ErrorEnvelope = {
  statusCode?: number;
  body?: unknown;
};

/**
 * `music.composeDetailed()` currently wraps typed SDK errors in a plain Error,
 * but preserves `Status code: N` and `Body: {json}` in its message. Recover
 * those fields so callers still get useful permanent/transient classifications.
 */
export function extractWrappedError(error: unknown): ErrorEnvelope {
  const direct = error as { statusCode?: number; body?: unknown };
  if (direct?.statusCode || direct?.body) {
    return { statusCode: direct.statusCode, body: direct.body };
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  const statusMatch = message.match(/Status code:\s*(\d{3})/i);
  const bodyMarker = message.indexOf("Body:");
  let body: unknown;
  if (bodyMarker >= 0) {
    const raw = message.slice(bodyMarker + "Body:".length).trim();
    try {
      body = JSON.parse(raw);
    } catch {
      body = undefined;
    }
  }
  return {
    statusCode: statusMatch ? Number(statusMatch[1]) : undefined,
    body,
  };
}

export function parseProviderError(error: unknown): ProviderError {
  const fallback: ProviderError = {
    code: "generation_failed",
    message: "The song could not be generated. Try another request.",
  };

  const { statusCode, body } = extractWrappedError(error);
  const detail = (body as { detail?: unknown } | undefined)?.detail;

  // FastAPI validation errors use an array of { loc, msg, type }.
  if (Array.isArray(detail)) {
    const message = detail
      .map((entry) => (entry as { msg?: unknown })?.msg)
      .filter((value): value is string => typeof value === "string")
      .join("; ");
    return { code: "validation_error", message: message || fallback.message };
  }

  const structured = detail as
    | {
        status?: string;
        message?: string;
        data?: {
          prompt_suggestion?: string;
          composition_plan_suggestion?: string;
        };
      }
    | undefined;

  if (structured?.status === "bad_prompt") {
    return {
      code: "bad_prompt",
      message:
        structured.message ||
        "This request was rejected because it referenced protected material.",
      suggestion: structured.data?.prompt_suggestion,
    };
  }

  if (structured?.status) {
    return {
      code: structured.status,
      message: structured.message || fallback.message,
      suggestion: structured.data?.composition_plan_suggestion,
    };
  }

  if (statusCode === 401) {
    return {
      code: "auth_failed",
      message: "The ElevenLabs API key was rejected. Reconnect a valid key.",
    };
  }
  if (statusCode === 403) {
    return {
      code: "forbidden",
      message:
        "The ElevenLabs key isn't permitted to generate music (plan or access).",
    };
  }
  if (statusCode === 408 || statusCode === 429 || (statusCode ?? 0) >= 500) {
    return {
      code: statusCode === 429 ? "rate_limited" : "provider_unavailable",
      message:
        statusCode === 429
          ? "ElevenLabs is rate-limiting this key. Try again shortly."
          : "ElevenLabs is temporarily unavailable. Try again shortly.",
    };
  }

  return fallback;
}
