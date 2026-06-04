import { handleCallback } from "@vercel/queue";

import { processGenerationJob, type GenerationJob } from "@/lib/generation";

export const runtime = "nodejs";
export const maxDuration = 800;

export const POST = handleCallback(async (job: GenerationJob) => {
  await processGenerationJob({ ...job, source: "queue" });
});
