import "server-only";

import { after } from "next/server";

import { processGenerationJob } from "@/lib/generation";
import { generateSongWorkflow } from "@/workflows/generate-song";

const QUEUE_TOPIC = "song-generation";

export async function enqueueGeneration(requestId: string) {
  if (process.env.ENABLE_VERCEL_WORKFLOW !== "false") {
    try {
      const { start } = await import("workflow/api");
      const run = await start(generateSongWorkflow, [{ requestId }]);
      return { mode: "workflow" as const, runId: run.runId };
    } catch (error) {
      console.error("Vercel Workflow start failed; checking fallbacks", error);
    }
  }

  if (process.env.ENABLE_VERCEL_QUEUE === "true") {
    try {
      const { send } = await import("@vercel/queue");
      await send(QUEUE_TOPIC, { requestId });
      return { mode: "queue" as const };
    } catch (error) {
      console.error("Vercel Queue enqueue failed; using after() fallback", error);
    }
  }

  after(async () => {
    await processGenerationJob({ requestId, source: "after" });
  });

  return { mode: "after" as const };
}
