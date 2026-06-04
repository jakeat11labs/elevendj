import type { Metadata } from "next";

import { StageScreen } from "@/app/stage/stage-screen";

export const metadata: Metadata = {
  title: "ElevenDJ — Stage",
  description: "Fullscreen hero-mode stage for live AI music playback.",
};

export default function StagePage() {
  return <StageScreen />;
}
