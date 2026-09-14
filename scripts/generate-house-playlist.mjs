import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const out = process.argv[3] ?? "public/offsite/cancun-2026/house-playlist";
await mkdir(out, { recursive: true });

const songs = JSON.parse(await readFile(process.argv[2], "utf8"));
console.log(`Generating ${songs.length} songs with Eleven Music 2.5\n`);

// Pull the lyric lines out of whichever composition-plan shape comes back, so
// the player's karaoke has something to show and we can prove the take has
// vocals at all rather than discovering an instrumental at showtime.
function lyricLines(meta) {
  const plan = meta?.compositionPlan ?? meta?.composition_plan;
  if (!plan) return [];
  if (Array.isArray(plan.sections)) {
    return plan.sections.flatMap((s) => s.lines ?? []).filter(Boolean);
  }
  if (Array.isArray(plan.chunks)) {
    return plan.chunks
      .flatMap((c) => String(c.text ?? "").split("\n"))
      .map((line) => line.trim())
      .filter((line) => line && !/^\[.*\]$/.test(line) && !/^\{.*\}$/.test(line));
  }
  return [];
}

const results = [];
for (const [index, song] of songs.entries()) {
  const label = `${song.id} ${song.title}`;
  process.stdout.write(`[${index + 1}/${songs.length}] ${label} … `);
  const startedAt = Date.now();

  let saved = false;
  for (let attempt = 1; attempt <= 3 && !saved; attempt += 1) {
    try {
      const result = await client.music.composeDetailed({
        prompt: song.prompt,
        musicLengthMs: song.lengthS * 1000,
        modelId: "music_v2_5",
        outputFormat: "mp3_48000_192",
        withTimestamps: true,
      });

      const audio =
        result.audio instanceof Uint8Array
          ? Buffer.from(result.audio)
          : Buffer.from(await result.audio.arrayBuffer());

      const meta =
        typeof result.json === "string"
          ? JSON.parse(result.json)
          : (result.json ?? null);
      const lines = lyricLines(meta);
      const songMeta = meta?.songMetadata ?? meta?.song_metadata ?? {};

      if (lines.length === 0 && attempt < 3) {
        process.stdout.write(`no lyrics, retry … `);
        continue;
      }

      const slug = `${song.id.toLowerCase()}-${song.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")}`;

      await writeFile(path.join(out, `${slug}.mp3`), audio);
      await writeFile(
        path.join(out, `${slug}.json`),
        JSON.stringify(
          {
            ...song,
            slug,
            file: `${slug}.mp3`,
            modelId: "music_v2_5",
            outputFormat: "mp3_48000_192",
            generatedTitle: songMeta.title ?? null,
            genres: songMeta.genres ?? [],
            languages: songMeta.languages ?? [],
            isExplicit: songMeta.isExplicit ?? songMeta.is_explicit ?? null,
            lyricLineCount: lines.length,
            lyrics: lines,
            compositionPlan: meta?.compositionPlan ?? meta?.composition_plan ?? null,
            wordsTimestamps: meta?.wordsTimestamps ?? meta?.words_timestamps ?? null,
            attempts: attempt,
          },
          null,
          2
        )
      );

      const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(
        `ok (${(audio.length / 1024 / 1024).toFixed(1)} MB, ${lines.length} lyric lines, ${secs}s)`
      );
      results.push({ id: song.id, ok: true, lines: lines.length });
      saved = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 3) {
        console.log(`FAILED — ${message.slice(0, 160)}`);
        results.push({ id: song.id, ok: false, error: message.slice(0, 200) });
      } else {
        process.stdout.write(`error, retry … `);
      }
    }
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${songs.length} generated.`);
if (failed.length) console.log("failed:", failed);
