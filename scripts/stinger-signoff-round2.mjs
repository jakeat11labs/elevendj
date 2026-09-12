import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createReadStream } from "node:fs";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");
const client = new ElevenLabsClient({ apiKey });

const out = "public/offsite/cancun-2026/stinger-signoff-round2";
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const ANTI_SONG = [
  "song structure",
  "verse",
  "chorus",
  "bridge",
  "long melodic development",
  "repeated hook",
  "fade out",
  "long intro",
  "instrumental only",
  "wordless vocals",
  "omitted words",
  "obscured speech",
  "regional accent",
  "patois",
];

// The four recipes kept in the prompt lab, musically unchanged.
const recipes = {
  C1: {
    approach: "Sung hook → spoken sign-off · two chunks · 9s",
    durationMs: 9000,
    styles: [
      "radio jingle package",
      "sung station logo",
      "bright brass and percussion",
      "spoken sign-off at the end",
      "hard button ending",
      "great production quality",
    ],
    build: (signoff) => [
      { text: "[Station ID]\nCancún Offsite 2026.", durationMs: 5000 },
      { text: `[Tag]\n${signoff}`, durationMs: 4000 },
    ],
  },
  C2: {
    approach: "Spoken open → sung sign-off · two chunks · 9s",
    durationMs: 9000,
    styles: [
      "broadcast imaging",
      "spoken announcer opening",
      "sung brand sign-off",
      "tropical funk bed",
      "wah guitar and tight drums",
      "hard stop ending",
      "great production quality",
    ],
    build: (signoff) => [
      { text: "[Tag]\nThis is the Cancún Offsite 2026.", durationMs: 4500 },
      { text: `[Station ID]\n${signoff}`, durationMs: 4500 },
    ],
  },
  D2: {
    approach: "Single chunk · [Station ID] · 10s",
    durationMs: 10000,
    styles: [
      "radio station imaging, not a song",
      "sung station identification",
      "calypso pop bed",
      "steel pan and hand percussion",
      "bright and concise arrangement",
      "hard stop ending",
      "great production quality",
    ],
    build: (signoff) => [
      {
        text: `[Station ID]\nAll week long at the Cancún Offsite 2026. ${signoff}`,
        durationMs: 10000,
      },
    ],
  },
  E1: {
    approach: "Retro jingle-house · [Jingle] · 8s",
    durationMs: 8000,
    styles: [
      "classic commercial radio jingle house production",
      "big sung logo with brass section",
      "retro pop jingle arrangement",
      "tight rhythm section",
      "triumphant final chord",
      "hard button ending",
      "great production quality",
    ],
    build: (signoff) => [
      {
        text: `[Jingle]\nCancún Offsite 2026. ${signoff}`,
        durationMs: 8000,
      },
    ],
  },
};

// The one thing under test this round: what noun carries the attribution.
const signoffs = [
  { key: "vibes", text: "Good vibes powered by Eleven Music.", keyword: "vibes" },
  { key: "jams", text: "Island jams powered by Eleven Music.", keyword: "jams" },
  { key: "tunes", text: "Every tune powered by Eleven Music.", keyword: "tune" },
];

const normalize = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b11\s*labs\b/g, "elevenlabs")
    .replace(/\beleven\s+labs\b/g, "elevenlabs")
    .replace(/\b11\s+music\b/g, "eleven music")
    .replace(/two thousand twenty[ -]?six/g, "2026")
    .replace(/twenty[ -]?twenty[ -]?six/g, "2026")
    .replace(/20[ -]?26/g, "2026")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

for (const [recipeId, recipe] of Object.entries(recipes)) {
  for (const signoff of signoffs) {
    const id = `${recipeId}-${signoff.key}`;
    const base = path.join(out, id);
    const chunks = recipe
      .build(signoff.text)
      .map((chunk) => ({
        ...chunk,
        positiveStyles: recipe.styles,
        negativeStyles: ANTI_SONG,
        contextAdherence: "high",
      }));

    let verified = false;
    let transcript = "";

    for (let attempt = 1; attempt <= 5 && !verified; attempt += 1) {
      const result = await client.music.composeDetailed({
        compositionPlan: { chunks },
        modelId: "music_v2_5",
        outputFormat: "mp3_48000_192",
        withTimestamps: true,
      });
      const audio =
        result.audio instanceof Uint8Array
          ? Buffer.from(result.audio)
          : Buffer.from(await result.audio.arrayBuffer());
      const candidate = `${base}.candidate.mp3`;
      await writeFile(candidate, audio);

      const stt = await client.speechToText.convert({
        file: createReadStream(candidate),
        modelId: "scribe_v2",
        languageCode: "en",
        tagAudioEvents: false,
        diarize: false,
      });
      transcript =
        "text" in stt && typeof stt.text === "string" ? stt.text.trim() : "";
      const n = normalize(transcript);
      verified =
        n.includes("offsite") &&
        n.includes("2026") &&
        n.includes(signoff.keyword) &&
        n.endsWith("powered by eleven music") &&
        !n.includes("elevenlabs music");

      console.log(
        `${id} attempt ${attempt}: ${verified ? "VERIFIED" : "retry"} — ${JSON.stringify(transcript)}`
      );

      if (verified) {
        await writeFile(`${base}.mp3`, audio);
        await writeFile(
          `${base}.json`,
          JSON.stringify(
            {
              id,
              recipeId,
              approach: recipe.approach,
              signoffKey: signoff.key,
              signoff: signoff.text,
              durationMs: recipe.durationMs,
              chunkCount: chunks.length,
              promptText: chunks.map((c) => c.text).join("\n---\n"),
              positiveStyles: recipe.styles,
              negativeStyles: ANTI_SONG,
              modelId: "music_v2_5",
              outputFormat: "mp3_48000_192",
              transcript,
              anchorsVerified: true,
              attempts: attempt,
            },
            null,
            2
          )
        );
      }
      await unlink(candidate).catch(() => {});
    }

    if (!verified) {
      console.log(`!! ${id} failed after 5 attempts; last: ${JSON.stringify(transcript)}`);
    }
  }
}

console.log("Round 2 complete.");
