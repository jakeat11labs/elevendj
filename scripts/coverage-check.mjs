import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const dir = process.argv[2];
const files = (await readdir(dir)).filter((f) => f.endsWith(".mp3")).sort();

for (const file of files) {
  const p = `${dir}/${file}`;
  const dur = parseFloat(
    execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1", p,
    ]).toString().trim()
  );

  const auto = await client.speechToText.convert({
    file: createReadStream(p),
    modelId: "scribe_v2",
    timestampsGranularity: "word",
    tagAudioEvents: false,
    diarize: false,
  });
  const words = (auto.words ?? []).filter((w) => w.type === "word");
  const first = words.length ? words[0].start : null;
  const last = words.length ? words[words.length - 1].end : null;
  const covered = first != null && last != null ? last - first : 0;
  const tail = last != null ? dur - last : dur;

  // Force Spanish and compare: if the audio really were Spanish, a forced
  // Spanish pass should produce coherent Spanish rather than gibberish.
  const es = await client.speechToText.convert({
    file: createReadStream(p),
    modelId: "scribe_v2",
    languageCode: "es",
    tagAudioEvents: false,
    diarize: false,
  });
  const esText = "text" in es && typeof es.text === "string" ? es.text.trim() : "";

  console.log(
    `${file.padEnd(16)} dur=${dur.toFixed(1)}s voice=${first?.toFixed(1) ?? "-"}–${last?.toFixed(1) ?? "-"}s ` +
      `(${covered.toFixed(1)}s sung, ${tail.toFixed(1)}s tail)`
  );
  console.log(`   es-forced: ${JSON.stringify(esText)}`);
}
