import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computePlayingPositionMs,
  shouldSeekForDrift,
} from "../src/lib/playback/timeline.ts";

describe("playback timeline", () => {
  it("returns base position when paused", () => {
    assert.equal(
      computePlayingPositionMs({
        basePositionMs: 1200,
        isPlaying: false,
        playbackStartedAt: new Date().toISOString(),
        nowMs: Date.now(),
      }),
      1200
    );
  });

  it("advances position while playing", () => {
    const started = Date.now() - 5000;
    const pos = computePlayingPositionMs({
      basePositionMs: 1000,
      isPlaying: true,
      playbackStartedAt: new Date(started).toISOString(),
      nowMs: started + 5000,
    });
    assert.equal(pos, 6000);
  });

  it("flags drift above threshold", () => {
    assert.equal(shouldSeekForDrift(0, 800), true);
    assert.equal(shouldSeekForDrift(0, 100), false);
  });
});
