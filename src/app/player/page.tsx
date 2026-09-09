import type { Metadata } from "next";

import { PlayerScreen } from "@/app/player/player-screen";

export const metadata: Metadata = {
  title: "ElevenDJ — Player",
  description: "Paired physical-space player for Offsite rooms.",
};

export const dynamic = "force-dynamic";

export default function PlayerPage() {
  return <PlayerScreen />;
}
