export type GenerateSongWorkflowInput = {
  requestId: string;
};

export async function generateSongWorkflow(input: GenerateSongWorkflowInput) {
  "use workflow";

  return runGeneration(input);
}

async function runGeneration(input: GenerateSongWorkflowInput) {
  "use step";

  console.log("ElevenDJ generation step started", {
    requestId: input.requestId,
  });
  const { processGenerationJob } = await import("@/lib/generation");
  const result = await processGenerationJob({
    requestId: input.requestId,
    source: "workflow",
  });
  console.log("ElevenDJ generation step completed", {
    requestId: input.requestId,
    ok: result.ok,
  });

  return result;
}
