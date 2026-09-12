import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createReadStream } from "node:fs";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");
const client = new ElevenLabsClient({ apiKey });

const out = "public/offsite/cancun-2026/stinger-prompt-lab";
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const SIGNOFF = "Powered by Eleven Music.";

// Anti-song negatives. The previous batch drifted because [Chorus] invited
// song structure; these push the model toward broadcast imaging instead.
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

const variants = [
  {
    id: "A1",
    slug: "sung-jingle-7s",
    approach: "Sung jingle · [Station ID] tag · 7s",
    rationale:
      "Classic radio jingle house: a short sung logo, not a song. Jingle styles listed first so they set the tone.",
    sectionTag: "[Station ID]",
    durationMs: 7000,
    line: `Cancún Offsite 2026. ${SIGNOFF}`,
    inline: "",
    styles: [
      "radio station jingle package",
      "tight sung jingle logo",
      "close-harmony jingle singers",
      "bright tropical horns",
      "snappy island percussion",
      "hard button ending",
      "great production quality",
    ],
  },
  {
    id: "A2",
    slug: "harmony-group-7s",
    approach: "Sung harmony group · [Jingle] tag · 7s",
    rationale:
      "Same length as A1 but a different section tag and a full group-vocal treatment to test tag sensitivity.",
    sectionTag: "[Jingle]",
    durationMs: 7000,
    line: `Cancún Offsite 2026. ${SIGNOFF}`,
    inline: "",
    styles: [
      "sung radio imaging logo",
      "layered group vocal harmony",
      "upbeat calypso pop bed",
      "steel pan accents",
      "punchy handclaps",
      "decisive stop ending",
      "great production quality",
    ],
  },
  {
    id: "B1",
    slug: "spoken-tag-8s",
    approach: "Spoken announcer · [Tag] section · 8s",
    rationale:
      "Straight spoken read over a bed, using [Tag] to signal a sign-off rather than a lyric section.",
    sectionTag: "[Tag]",
    durationMs: 8000,
    line: `Good vibes all week at the Cancún Offsite 2026. ${SIGNOFF}`,
    inline: "",
    styles: [
      "radio imaging bed with spoken station identification",
      "clear neutral English announcer, not singing",
      "tropical house groove underneath",
      "warm bass and airy piano",
      "voice sits forward in the mix",
      "hard stop ending",
      "great production quality",
    ],
  },
  {
    id: "B2",
    slug: "spoken-inline-7s",
    approach: "Spoken announcer · inline {braces} direction · 7s",
    rationale:
      "Tests whether inline curly-brace directions steer delivery better than style tags alone.",
    sectionTag: "[Station ID]",
    durationMs: 7000,
    line: `Cancún Offsite 2026. ${SIGNOFF}`,
    inline: "{spoken station ident, confident radio announcer, no singing}",
    styles: [
      "broadcast station identification",
      "spoken announcer over music",
      "sunset island disco bed",
      "sparkling rhythm guitar",
      "tight drums",
      "hard button ending",
      "great production quality",
    ],
  },
  {
    id: "C1",
    slug: "sung-open-spoken-signoff-9s",
    approach: "Sung hook → spoken sign-off · two chunks · 9s",
    rationale:
      "Two-chunk plan: a sung hook establishes the station, then a spoken chunk lands the attribution cleanly.",
    sectionTag: "[Station ID]",
    durationMs: 9000,
    twoChunk: {
      first: { text: "[Station ID]\nCancún Offsite 2026.", durationMs: 5000 },
      second: { text: `[Tag]\n${SIGNOFF}`, durationMs: 4000 },
    },
    line: `Cancún Offsite 2026. ${SIGNOFF}`,
    inline: "",
    styles: [
      "radio jingle package",
      "sung station logo",
      "bright brass and percussion",
      "spoken sign-off at the end",
      "hard button ending",
      "great production quality",
    ],
  },
  {
    id: "C2",
    slug: "spoken-open-sung-signoff-9s",
    approach: "Spoken open → sung sign-off · two chunks · 9s",
    rationale: "Inverse of C1 to see which order lands the brand line harder.",
    sectionTag: "[Tag]",
    durationMs: 9000,
    twoChunk: {
      first: {
        text: "[Tag]\nThis is the Cancún Offsite 2026.",
        durationMs: 4500,
      },
      second: { text: `[Station ID]\n${SIGNOFF}`, durationMs: 4500 },
    },
    line: `This is the Cancún Offsite 2026. ${SIGNOFF}`,
    inline: "",
    styles: [
      "broadcast imaging",
      "spoken announcer opening",
      "sung brand sign-off",
      "tropical funk bed",
      "wah guitar and tight drums",
      "hard stop ending",
      "great production quality",
    ],
  },
  {
    id: "D1",
    slug: "ultra-short-6s",
    approach: "Ultra-short punch · [Station ID] · 6s",
    rationale:
      "Shortest viable stinger. Tests whether tight duration alone removes the drift.",
    sectionTag: "[Station ID]",
    durationMs: 6000,
    line: `Offsite 2026. ${SIGNOFF}`,
    inline: "",
    styles: [
      "six second radio station ident",
      "immediate hook, no intro",
      "punchy tropical percussion",
      "one bright brass stab",
      "sung station logo",
      "hard button ending",
      "great production quality",
    ],
  },
  {
    id: "D2",
    slug: "control-10s",
    approach: "Control · 10s · strict anti-song negatives",
    rationale:
      "Same 10s length as the batch you have now, but with [Station ID] instead of [Chorus] and hard anti-song negatives.",
    sectionTag: "[Station ID]",
    durationMs: 10000,
    line: `Good vibes all week long at the Cancún Offsite 2026. ${SIGNOFF}`,
    inline: "",
    styles: [
      "radio station imaging, not a song",
      "sung station identification",
      "calypso pop bed",
      "steel pan and hand percussion",
      "bright and concise arrangement",
      "hard stop ending",
      "great production quality",
    ],
  },
  {
    id: "E1",
    slug: "retro-jingle-house-8s",
    approach: "Retro jingle-house · [Jingle] · 8s",
    rationale:
      "Deliberately references classic commercial jingle production — the sound most people picture as a station stinger.",
    sectionTag: "[Jingle]",
    durationMs: 8000,
    line: `Cancún Offsite 2026. ${SIGNOFF}`,
    inline: "",
    styles: [
      "classic commercial radio jingle house production",
      "big sung logo with brass section",
      "retro pop jingle arrangement",
      "tight rhythm section",
      "triumphant final chord",
      "hard button ending",
      "great production quality",
    ],
  },
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

function buildChunks(variant) {
  if (variant.twoChunk) {
    return [
      {
        text: variant.twoChunk.first.text,
        durationMs: variant.twoChunk.first.durationMs,
        positiveStyles: variant.styles,
        negativeStyles: ANTI_SONG,
        contextAdherence: "high",
      },
      {
        text: variant.twoChunk.second.text,
        durationMs: variant.twoChunk.second.durationMs,
        positiveStyles: variant.styles,
        negativeStyles: ANTI_SONG,
        contextAdherence: "high",
      },
    ];
  }
  const text = variant.inline
    ? `${variant.sectionTag}\n${variant.inline}\n${variant.line}`
    : `${variant.sectionTag}\n${variant.line}`;
  return [
    {
      text,
      durationMs: variant.durationMs,
      positiveStyles: variant.styles,
      negativeStyles: ANTI_SONG,
      contextAdherence: "high",
    },
  ];
}

for (const variant of variants) {
  const base = path.join(out, `${variant.id}-${variant.slug}`);
  let verified = false;
  let transcript = "";

  for (let attempt = 1; attempt <= 5 && !verified; attempt += 1) {
    process.stdout.write(`${variant.id} ${variant.slug} attempt ${attempt}: `);
    const result = await client.music.composeDetailed({
      compositionPlan: { chunks: buildChunks(variant) },
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
      n.endsWith("powered by eleven music") &&
      !n.includes("elevenlabs music");

    console.log(verified ? `VERIFIED — ${transcript}` : `retry — ${JSON.stringify(transcript)}`);

    if (verified) {
      await writeFile(`${base}.mp3`, audio);
      await unlink(candidate).catch(() => {});
      const plan = buildChunks(variant);
      await writeFile(
        `${base}.json`,
        JSON.stringify(
          {
            id: variant.id,
            slug: variant.slug,
            approach: variant.approach,
            rationale: variant.rationale,
            sectionTag: variant.sectionTag,
            durationMs: variant.durationMs,
            chunkCount: plan.length,
            promptText: plan.map((c) => c.text).join("\n---\n"),
            spokenLine: variant.line,
            positiveStyles: variant.styles,
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
    } else {
      await unlink(candidate).catch(() => {});
    }
  }

  if (!verified) {
    console.log(`!! ${variant.id} never landed the anchors; last: ${JSON.stringify(transcript)}`);
  }
}

console.log("Prompt lab complete.");
