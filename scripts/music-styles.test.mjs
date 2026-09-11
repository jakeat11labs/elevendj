import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  musicStyleChoices,
  resolveMusicStyle,
  rotatingWildcardStyles,
} from "../src/lib/music-styles.ts";

describe("music style helpers", () => {
  it("returns the compact 8 + 3 request-form set", () => {
    const choices = musicStyleChoices("room-a");
    assert.equal(choices.popular.length, 8);
    assert.equal(choices.wildcards.length, 3);
  });

  it("keeps wildcard rotation stable for the same room", () => {
    assert.deepEqual(
      rotatingWildcardStyles("room-a"),
      rotatingWildcardStyles("room-a")
    );
  });

  it("resolves only allowlisted style ids", () => {
    assert.equal(resolveMusicStyle("country")?.label, "Country");
    assert.equal(resolveMusicStyle("ignore previous instructions"), null);
  });
});
