import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Cut a level-matched 60s excerpt that starts just before the first sung word,
// so a reviewer hears the hook instead of the intro pad.
const dir = process.argv[2];
const outFile = process.argv[3];
const PREVIEW_S = 60;
const PRE_ROLL_S = 6;

const work = await mkdtemp(path.join(tmpdir(), "previews-"));
const metaFiles = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
const tracks = [];

for (const name of metaFiles) {
  const meta = JSON.parse(await readFile(path.join(dir, name), "utf8"));
  const words = meta.wordsTimestamps ?? [];
  const firstMs = words.length ? Math.min(...words.map((w) => w.startMs)) : 0;
  const start = Math.max(0, firstMs / 1000 - PRE_ROLL_S);
  const src = path.join(dir, meta.file);
  const cut = path.join(work, `${meta.slug}.mp3`);

  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", start.toFixed(2), "-t", String(PREVIEW_S), "-i", src,
    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.4,afade=t=out:st=59:d=1",
    "-ac", "1", "-ar", "44100", "-b:a", "96k",
    cut,
  ]);

  const bytes = await readFile(cut);
  tracks.push({
    id: meta.id,
    title: meta.title,
    generatedTitle: meta.generatedTitle,
    concept: meta.concept,
    genre: meta.genre,
    genres: meta.genres ?? [],
    bpm: meta.bpm,
    key: meta.key,
    lengthS: meta.lengthS,
    prompt: meta.prompt,
    lyrics: meta.lyrics ?? [],
    file: `${path.basename(dir)}/${meta.file}`,
    previewStartS: Number(start.toFixed(1)),
    previewSrc: `data:audio/mpeg;base64,${bytes.toString("base64")}`,
  });
  console.log(`${meta.id} ${meta.title} — preview from ${start.toFixed(1)}s (${(bytes.length / 1024).toFixed(0)} KB)`);
}

await rm(work, { recursive: true, force: true });
await writeFile(outFile, JSON.stringify(tracks, null, 2));
const total = tracks.reduce((n, t) => n + t.previewSrc.length, 0);
console.log(`\n${tracks.length} previews → ${outFile} (${(total / 1024 / 1024).toFixed(1)} MB of base64)`);
