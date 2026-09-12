import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OFFSITE_STATION_ID_CADENCE,
  OFFSITE_STATION_IDS,
  createStationIdRotation,
} from "../src/lib/offsite-station-ids.ts";

test("offsite station ids", async (t) => {
  await t.test("every clip names the event and the attribution", () => {
    assert.ok(OFFSITE_STATION_IDS.length >= 8);
    for (const station of OFFSITE_STATION_IDS) {
      assert.match(station.line, /Offsite/i, station.id);
      assert.match(station.line, /2026/, station.id);
      assert.match(station.line, /powered by Eleven Music\.$/i, station.id);
      assert.match(station.url, /^\/offsite\/cancun-2026\/station-ids\//);
      assert.ok(station.durationMs > 3000 && station.durationMs < 15000);
    }
  });

  await t.test("ids and urls are unique", () => {
    assert.equal(new Set(OFFSITE_STATION_IDS.map((s) => s.id)).size, OFFSITE_STATION_IDS.length);
    assert.equal(new Set(OFFSITE_STATION_IDS.map((s) => s.url)).size, OFFSITE_STATION_IDS.length);
  });

  await t.test("plays every id before repeating any", () => {
    const draw = createStationIdRotation();
    const seen = new Set();
    for (let i = 0; i < OFFSITE_STATION_IDS.length; i += 1) {
      const station = draw();
      assert.ok(station);
      assert.ok(!seen.has(station.id), `${station.id} repeated within one cycle`);
      seen.add(station.id);
    }
    assert.equal(seen.size, OFFSITE_STATION_IDS.length);
  });

  await t.test("never repeats back to back across a reshuffle", () => {
    // Worst case for the boundary: a two-item bag, where a fresh shuffle has a
    // 50% chance of re-drawing the id that just played.
    const ids = [
      { id: "a", line: "a", url: "/a", durationMs: 8000 },
      { id: "b", line: "b", url: "/b", durationMs: 8000 },
    ];
    for (const random of [() => 0, () => 0.99, () => 0.5]) {
      const draw = createStationIdRotation(ids, random);
      let previous = null;
      for (let i = 0; i < 20; i += 1) {
        const station = draw();
        assert.ok(station);
        assert.notEqual(station.id, previous, "played the same id twice in a row");
        previous = station.id;
      }
    }
  });

  await t.test("handles an empty library without throwing", () => {
    assert.equal(createStationIdRotation([])(), null);
  });

  await t.test("cadence is two songs", () => {
    assert.equal(OFFSITE_STATION_ID_CADENCE, 2);
  });
});
