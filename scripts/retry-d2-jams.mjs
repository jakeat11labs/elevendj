import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createReadStream } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const base = "public/offsite/cancun-2026/stinger-signoff-round2/D2-jams";

const styles = [
  "radio station imaging, not a song",
  "sung station identification",
  "clear sung words, every lyric intelligible",
  "calypso pop bed",
  "steel pan and hand percussion",
  "bright and concise arrangement",
  "hard stop ending",
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

const signoff = "Island jams powered by Eleven Music.";
const text = `[Station ID]\nAll week long at the Cancún Offsite 2026. ${signoff}`;

const normalize = (v) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b11\s+music\b/g, "eleven music")
    .replace(/\beleven\s+labs\b/g, "elevenlabs")
    .replace(/20[ -]?26/g, "2026")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

for (let attempt = 1; attempt <= 8; attempt += 1) {
  const result = await client.music.composeDetailed({
    compositionPlan: {
      chunks: [
        {
          text,
          durationMs: 10000,
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
    languageCode: "en",
    tagAudioEvents: false,
    diarize: false,
  });
  const transcript =
    "text" in stt && typeof stt.text === "string" ? stt.text.trim() : "";
  const n = normalize(transcript);
  const ok =
    n.includes("offsite") &&
    n.includes("2026") &&
    (n.includes("jams") || n.includes("jam")) &&
    n.endsWith("powered by eleven music") &&
    !n.includes("elevenlabs music");

  console.log(`attempt ${attempt}: ${ok ? "VERIFIED" : "retry"} — ${JSON.stringify(transcript)}`);

  if (ok) {
    await writeFile(`${base}.mp3`, audio);
    await writeFile(
      `${base}.json`,
      JSON.stringify(
        {
          id: "D2-jams",
          recipeId: "D2",
          approach: "Single chunk · [Station ID] · 10s",
          signoffKey: "jams",
          signoff,
          durationMs: 10000,
          chunkCount: 1,
          promptText: text,
          positiveStyles: styles,
          negativeStyles: negatives,
          modelId: "music_v2_5",
          outputFormat: "mp3_48000_192",
          transcript,
          anchorsVerified: true,
          attempts: attempt,
          note: "Needed an explicit 'clear sung words' style and a hard 'instrumental' negative to stop returning a vocal-free take.",
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

console.log("D2-jams still failing");
process.exit(1);
