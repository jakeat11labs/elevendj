import type { Metadata } from "next";

import { StageScreen } from "@/app/stage/stage-screen";

export const metadata: Metadata = {
  title: "ElevenDJ — Stage",
  description: "Fullscreen hero-mode stage for live AI music playback.",
};

export const dynamic = "force-dynamic";

export default async function StagePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  return <StageScreen code={code ?? null} />;
}
