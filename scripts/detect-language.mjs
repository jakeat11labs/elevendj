import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const dirs = process.argv.slice(2);

for (const dir of dirs) {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".mp3")).sort();
  console.log(`\n=== ${dir}`);
  for (const file of files) {
    // No languageCode: let Scribe detect what is actually being sung.
    const result = await client.speechToText.convert({
      file: createReadStream(`${dir}/${file}`),
      modelId: "scribe_v2",
      tagAudioEvents: false,
      diarize: false,
    });
    const text =
      "text" in result && typeof result.text === "string"
        ? result.text.trim()
        : "";
    const lang = result.languageCode ?? "?";
    const prob =
      typeof result.languageProbability === "number"
        ? result.languageProbability.toFixed(2)
        : "?";
    const flag = lang === "en" ? "  " : "!!";
    console.log(`${flag} ${file.padEnd(30)} [${lang} ${prob}] ${JSON.stringify(text)}`);
  }
}
