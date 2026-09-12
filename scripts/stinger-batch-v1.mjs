import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createReadStream } from "node:fs";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const out = "public/offsite/cancun-2026/stinger-batch-v1";
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// Verbatim from the prompt lab. No accent pinning — that pass made these worse.
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

const C2_STYLES = [
  "broadcast imaging",
  "spoken announcer opening",
  "sung brand sign-off",
  "tropical funk bed",
  "wah guitar and tight drums",
  "hard stop ending",
  "great production quality",
];

const E1_STYLES = [
  "classic commercial radio jingle house production",
  "big sung logo with brass section",
  "retro pop jingle arrangement",
  "tight rhythm section",
  "triumphant final chord",
  "hard button ending",
  "great production quality",
];

// C2: spoken station line, then the sign-off sung as the payoff.
const c2 = [
  ["This is the Cancún Offsite 2026.", "Good vibes powered by Eleven Music.", "vibes"],
  ["Welcome to the Cancún Offsite 2026.", "Island jams powered by Eleven Music.", "jams"],
  ["You're at the Cancún Offsite 2026.", "Every tune powered by Eleven Music.", "tune"],
  ["Sessions and sunsets. Offsite 2026.", "The soundtrack powered by Eleven Music.", "soundtrack"],
  ["All week long at the Cancún Offsite 2026.", "Good vibes powered by Eleven Music.", "vibes"],
  ["Work hard, vibe easy. Offsite 2026.", "Island jams powered by Eleven Music.", "jams"],
  ["Big ideas and warm water. Offsite 2026.", "Every tune powered by Eleven Music.", "tune"],
  ["One team, one week. Cancún Offsite 2026.", "Every beat powered by Eleven Music.", "beat"],
];

// E1: one 8s retro jingle chunk, so the copy stays short.
const e1 = [
  ["Cancún Offsite 2026. Good vibes powered by Eleven Music.", "vibes"],
  ["Cancún Offsite 2026. Island jams powered by Eleven Music.", "jams"],
  ["Offsite 2026. Every tune powered by Eleven Music.", "tune"],
  ["Sunshine and big ideas. Offsite 2026. Good vibes powered by Eleven Music.", "vibes"],
  ["Welcome to the Cancún Offsite 2026. Every beat powered by Eleven Music.", "beat"],
  ["Good people, good music. Offsite 2026. Island jams powered by Eleven Music.", "jams"],
  ["Cancún Offsite 2026. The soundtrack powered by Eleven Music.", "soundtrack"],
  ["From sessions to sunsets. Offsite 2026. Good vibes powered by Eleven Music.", "vibes"],
];

const jobs = [
  ...c2.map((entry, i) => ({
    id: `C2-${String(i + 1).padStart(2, "0")}`,
    recipe: "C2",
    approach: "Spoken open → sung sign-off · two chunks · 9s",
    keyword: entry[2],
    line: `${entry[0]} ${entry[1]}`,
    styles: C2_STYLES,
    chunks: [
      { text: `[Tag]\n${entry[0]}`, durationMs: 4500 },
      { text: `[Station ID]\n${entry[1]}`, durationMs: 4500 },
    ],
  })),
  ...e1.map((entry, i) => ({
    id: `E1-${String(i + 1).padStart(2, "0")}`,
    recipe: "E1",
    approach: "Retro jingle-house · [Jingle] · 8s",
    keyword: entry[1],
    line: entry[0],
    styles: E1_STYLES,
    chunks: [{ text: `[Jingle]\n${entry[0]}`, durationMs: 8000 }],
  })),
];

const normalize = (v) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b11\s+music\b/g, "eleven music")
    .replace(/\beleven\s+labs\s+music\b/g, "ELEVENLABS_MUSIC")
    .replace(/two thousand twenty[ -]?six/g, "2026")
    .replace(/twenty[ -]?twenty[ -]?six/g, "2026")
    .replace(/20[ -]?26/g, "2026")
    .replace(/[^a-z0-9_]+/g, " ")
    .trim();

let ok = 0;
for (const job of jobs) {
  const base = path.join(out, `${job.id}`);
  const chunks = job.chunks.map((c) => ({
    ...c,
    positiveStyles: job.styles,
    negativeStyles: ANTI_SONG,
    contextAdherence: "high",
  }));

  let verified = false;
  let transcript = "";
  let lang = "?";
  let prob = 0;

  for (let attempt = 1; attempt <= 6 && !verified; attempt += 1) {
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

    // Auto-detect so the language is recorded, but do not gate on accent —
    // the neutral-English pass changed the character in a way you disliked.
    const stt = await client.speechToText.convert({
      file: createReadStream(candidate),
      modelId: "scribe_v2",
      tagAudioEvents: false,
      diarize: false,
    });
    transcript =
      "text" in stt && typeof stt.text === "string" ? stt.text.trim() : "";
    lang = stt.languageCode ?? "?";
    prob =
      typeof stt.languageProbability === "number" ? stt.languageProbability : 0;

    const n = normalize(transcript);
    verified =
      n.includes("offsite") &&
      n.includes("2026") &&
      n.includes(job.keyword) &&
      n.endsWith("powered by eleven music") &&
      !n.includes("elevenlabs_music");

    console.log(
      `${job.id} attempt ${attempt}: ${verified ? "OK " : "retry"} [${lang} ${prob.toFixed(2)}] ${JSON.stringify(transcript)}`
    );

    if (verified) {
      await writeFile(`${base}.mp3`, audio);
      await writeFile(
        `${base}.json`,
        JSON.stringify(
          {
            id: job.id,
            recipe: job.recipe,
            approach: job.approach,
            line: job.line,
            keyword: job.keyword,
            promptText: chunks.map((c) => c.text).join("\n---\n"),
            positiveStyles: job.styles,
            negativeStyles: ANTI_SONG,
            modelId: "music_v2_5",
            outputFormat: "mp3_48000_192",
            transcript,
            detectedLanguage: lang,
            languageProbability: prob,
            attempts: attempt,
          },
          null,
          2
        )
      );
      ok += 1;
    }
    await unlink(candidate).catch(() => {});
  }

  if (!verified) console.log(`!! ${job.id} failed: ${JSON.stringify(transcript)}`);
}

console.log(`\n${ok}/${jobs.length} verified.`);
