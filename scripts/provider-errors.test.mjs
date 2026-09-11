import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractWrappedError,
  parseProviderError,
} from "../src/lib/generation/provider-errors.ts";

describe("Music provider errors", () => {
  it("recovers status and body from composeDetailed's plain Error wrapper", () => {
    const error = new Error(
      'Failed to parse detailed composition response: Status code: 422\nBody: {"detail":{"status":"bad_prompt","message":"Protected material","data":{"prompt_suggestion":"Try a bright original pop hook"}}}'
    );
    const envelope = extractWrappedError(error);
    assert.equal(envelope.statusCode, 422);
    assert.deepEqual(parseProviderError(error), {
      code: "bad_prompt",
      message: "Protected material",
      suggestion: "Try a bright original pop hook",
    });
  });

  it("preserves direct SDK errors when available", () => {
    assert.deepEqual(
      parseProviderError({ statusCode: 401, body: null }),
      {
        code: "auth_failed",
        message: "The ElevenLabs API key was rejected. Reconnect a valid key.",
      }
    );
  });

  it("classifies transient provider responses", () => {
    assert.equal(
      parseProviderError(
        new Error("Status code: 429\nBody: {}")
      ).code,
      "rate_limited"
    );
    assert.equal(
      parseProviderError(
        new Error("Status code: 503\nBody: {}")
      ).code,
      "provider_unavailable"
    );
  });
});
