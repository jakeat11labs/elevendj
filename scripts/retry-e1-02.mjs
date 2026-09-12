import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createReadStream } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const base = "public/offsite/cancun-2026/stinger-batch-v1/E1-02";

// E1 styles plus the vocal-forcing line that rescued D2-jams earlier.
const styles = [
  "classic commercial radio jingle house production",
  "big sung logo with brass section",
  "clear sung words, every lyric intelligible",
  "retro pop jingle arrangement",
  "tight rhythm section",
  "triumphant final chord",
  "hard button ending",
  "great production quality",
];

const negatives = [
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
  "regional accent",
  "patois",
];

const line = "Cancún Offsite 2026. Island jams powered by Eleven Music.";

const normalize = (v) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b11\s+music\b/g, "eleven music")
    .replace(/\b20+2+6\b/g, "2026")
    .replace(/20[ -]?26/g, "2026")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

for (let attempt = 1; attempt <= 8; attempt += 1) {
  const result = await client.music.composeDetailed({
    compositionPlan: {
      chunks: [
        {
          text: `[Jingle]\n${line}`,
          durationMs: 8000,
          positiveStyles: styles,
          negativeStyles: negatives,
          contextAdherence: "high",
        },
      ],
    },
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
    tagAudioEvents: false,
    diarize: false,
  });
  const transcript =
    "text" in stt && typeof stt.text === "string" ? stt.text.trim() : "";
  const lang = stt.languageCode ?? "?";
  const prob =
    typeof stt.languageProbability === "number" ? stt.languageProbability : 0;
  const n = normalize(transcript);
  const ok =
    n.includes("offsite") &&
    n.includes("2026") &&
    (n.includes("jams") || n.includes("jamz") || n.includes("jam")) &&
    n.endsWith("powered by eleven music");

  console.log(`attempt ${attempt}: ${ok ? "OK " : "retry"} [${lang} ${prob.toFixed(2)}] ${JSON.stringify(transcript)}`);

  if (ok) {
    await writeFile(`${base}.mp3`, audio);
    await writeFile(
      `${base}.json`,
      JSON.stringify(
        {
          id: "E1-02",
          recipe: "E1",
          approach: "Retro jingle-house · [Jingle] · 8s",
          line,
          keyword: "jams",
          promptText: `[Jingle]\n${line}`,
          positiveStyles: styles,
          negativeStyles: negatives,
          modelId: "music_v2_5",
          outputFormat: "mp3_48000_192",
          transcript,
          detectedLanguage: lang,
          languageProbability: prob,
          attempts: attempt,
          note: "Needed 'clear sung words' style and a hard 'instrumental' negative; 'jams' is the least reliable word in the set.",
        },
        null,
        2
      )
    );
    await unlink(candidate).catch(() => {});
    process.exit(0);
  }
  await unlink(candidate).catch(() => {});
}
console.log("E1-02 still failing");
process.exit(1);
