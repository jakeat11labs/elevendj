import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createReadStream } from "node:fs";
import { readdir, rm, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const dir = process.argv[2];
const tmp = "/tmp/stinger-tails";
await rm(tmp, { recursive: true, force: true });
await mkdir(tmp, { recursive: true });

const files = (await readdir(dir)).filter((f) => f.endsWith(".mp3")).sort();

for (const file of files) {
  const p = `${dir}/${file}`;
  const dur = parseFloat(
    execFileSync("ffprobe", ["-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",p])
      .toString().trim()
  );

  const full = await client.speechToText.convert({
    file: createReadStream(p),
    modelId: "scribe_v2",
    timestampsGranularity: "word",
    tagAudioEvents: true,
    diarize: false,
  });
  const words = (full.words ?? []).filter((w) => w.type === "word");
  const last = words.length ? words[words.length - 1].end : 0;
  const tailLen = dur - last;

  if (tailLen < 1.0) {
    console.log(`${file.padEnd(16)} tail ${tailLen.toFixed(1)}s — too short to matter`);
    continue;
  }

  const out = `${tmp}/${file}`;
  execFileSync("ffmpeg", ["-y","-v","error","-i",p,"-ss",String(last),"-t",String(tailLen),out]);

  const tail = await client.speechToText.convert({
    file: createReadStream(out),
    modelId: "scribe_v2",
    tagAudioEvents: true,
    diarize: false,
  });
  const text = "text" in tail && typeof tail.text === "string" ? tail.text.trim() : "";
  const lang = tail.languageCode ?? "?";
  console.log(
    `${file.padEnd(16)} tail ${last.toFixed(1)}–${dur.toFixed(1)}s (${tailLen.toFixed(1)}s) [${lang}] ${JSON.stringify(text)}`
  );
}
