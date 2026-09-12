import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createReadStream } from "node:fs";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const out = "public/offsite/cancun-2026/accent-fix";
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// Restored from the original 20-clip batch: pin the language and accent
// explicitly, and rule out the Latin/Spanish delivery the tropical beds invite.
const ENGLISH_PIN = [
  "clear neutral American English vocal",
  "every word sung in English with standard American pronunciation",
  "professional English-language radio jingle singers",
];

const NEGATIVES = [
  "Spanish language",
  "Spanish lyrics",
  "Spanish vocals",
  "Spanish accent",
  "Latin American accent",
  "Caribbean-accented vocal",
  "patois",
  "regional accent",
  "non-English words",
  "song structure",
  "verse",
  "chorus",
  "bridge",
  "long melodic development",
  "repeated hook",
  "fade out",
  "long intro",
  "instrumental",
  "instrumental only",
  "wordless vocals",
  "omitted words",
  "obscured speech",
];

const SIGNOFF = "Good vibes powered by Eleven Music.";

const recipes = [
  {
    id: "C1",
    approach: "Sung hook → spoken sign-off · two chunks · 9s",
    styles: [
      ...ENGLISH_PIN,
      "radio jingle package",
      "sung station logo",
      "bright brass and percussion",
      "spoken sign-off at the end",
      "hard button ending",
      "great production quality",
    ],
    chunks: [
      { text: "[Station ID]\nCancun Offsite 2026.", durationMs: 5000 },
      { text: `[Tag]\n${SIGNOFF}`, durationMs: 4000 },
    ],
  },
  {
    id: "C2",
    approach: "Spoken open → sung sign-off · two chunks · 9s",
    styles: [
      ...ENGLISH_PIN,
      "broadcast imaging",
      "spoken announcer opening",
      "sung brand sign-off",
      "tropical funk bed",
      "wah guitar and tight drums",
      "hard stop ending",
      "great production quality",
    ],
    chunks: [
      { text: "[Tag]\nThis is the Cancun Offsite 2026.", durationMs: 4500 },
      { text: `[Station ID]\n${SIGNOFF}`, durationMs: 4500 },
    ],
  },
  {
    id: "D2",
    approach: "Single chunk · [Station ID] · 10s",
    styles: [
      ...ENGLISH_PIN,
      "radio station imaging, not a song",
      "sung station identification",
      "calypso pop bed",
      "steel pan and hand percussion",
      "bright and concise arrangement",
      "hard stop ending",
      "great production quality",
    ],
    chunks: [
      {
        text: `[Station ID]\nAll week long at the Cancun Offsite 2026. ${SIGNOFF}`,
        durationMs: 10000,
      },
    ],
  },
  {
    id: "E1",
    approach: "Retro jingle-house · [Jingle] · 8s",
    styles: [
      ...ENGLISH_PIN,
      "classic commercial radio jingle house production",
      "big sung logo with brass section",
      "retro pop jingle arrangement",
      "tight rhythm section",
      "triumphant final chord",
      "hard button ending",
      "great production quality",
    ],
    chunks: [
      { text: `[Jingle]\nCancun Offsite 2026. ${SIGNOFF}`, durationMs: 8000 },
    ],
  },
];

const normalize = (v) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b11\s+music\b/g, "eleven music")
    .replace(/20[ -]?26/g, "2026")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

for (const recipe of recipes) {
  const base = path.join(out, `${recipe.id}-fixed`);
  const chunks = recipe.chunks.map((c) => ({
    ...c,
    positiveStyles: recipe.styles,
    negativeStyles: NEGATIVES,
    contextAdherence: "high",
  }));

  let ok = false;
  for (let attempt = 1; attempt <= 6 && !ok; attempt += 1) {
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

    // Auto-detect language this time — no forced English, so a Spanish
    // delivery has a chance to show up instead of being papered over.
    const stt = await client.speechToText.convert({
      file: createReadStream(candidate),
      modelId: "scribe_v2",
      tagAudioEvents: false,
      diarize: false,
    });
    const transcript =
      "text" in stt && typeof stt.text === "string" ? stt.text.trim() : "";
    const lang = stt.languageCode ?? "?";
    const prob =
      typeof stt.languageProbability === "number" ? stt.languageProbability : 0;
    const n = normalize(transcript);

    ok =
      lang.startsWith("en") &&
      prob >= 0.85 &&
      n.includes("offsite") &&
      n.includes("2026") &&
      n.includes("vibes") &&
      n.endsWith("powered by eleven music");

    console.log(
      `${recipe.id} attempt ${attempt}: ${ok ? "VERIFIED" : "retry"} [${lang} ${prob.toFixed(2)}] ${JSON.stringify(transcript)}`
    );

    if (ok) {
      await writeFile(`${base}.mp3`, audio);
      await writeFile(
        `${base}.json`,
        JSON.stringify(
          {
            id: `${recipe.id}-fixed`,
            recipeId: recipe.id,
            approach: recipe.approach,
            signoff: SIGNOFF,
            promptText: chunks.map((c) => c.text).join("\n---\n"),
            positiveStyles: recipe.styles,
            negativeStyles: NEGATIVES,
            modelId: "music_v2_5",
            transcript,
            detectedLanguage: lang,
            languageProbability: prob,
            attempts: attempt,
          },
          null,
          2
        )
      );
    }
    await unlink(candidate).catch(() => {});
  }
  if (!ok) console.log(`!! ${recipe.id} did not reach a confident English take`);
}

console.log("Accent fix pass complete.");
