import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAutoDjPrompt } from "../src/lib/autodj.ts";

const EVENING = new Date("2026-09-14T19:30:00");

describe("autodj prompt", () => {
  it("leads with the brief and punctuates it", () => {
    const prompt = buildAutoDjPrompt({
      brief: "warm arrival house for a rooftop reception",
      now: EVENING,
    });
    assert.ok(
      prompt.startsWith("warm arrival house for a rooftop reception."),
      prompt
    );
  });

  it("keeps punctuation the brief already has", () => {
    const prompt = buildAutoDjPrompt({ brief: "keep it mellow!", now: EVENING });
    assert.ok(prompt.startsWith("keep it mellow!"), prompt);
    assert.ok(!prompt.includes("mellow!."), prompt);
  });

  it("names the agenda item, room, and time of day", () => {
    const prompt = buildAutoDjPrompt({
      brief: "anything",
      sessionName: "Opening Reception",
      roomName: "Main Hall",
      now: EVENING,
    });
    assert.ok(
      prompt.includes("at Opening Reception in Main Hall (evening)"),
      prompt
    );
  });

  it("falls back to a house style without a brief", () => {
    const prompt = buildAutoDjPrompt({ now: EVENING });
    assert.ok(prompt.length > 60, prompt);
    assert.ok(prompt.includes("instrumental track"), prompt);
  });
});
