import type { Metadata } from "next";

import { RoomDjConsole } from "./room-dj-console";

export const metadata: Metadata = {
  title: "Room DJ",
  description: "Simplified controls for an ElevenDJ Offsite room.",
};

export const dynamic = "force-dynamic";

export default function RoomDjPage() {
  // The page itself is public so a fragment-based emergency link can exchange
  // its credential. Every data/mutation route enforces operator access.
  return <RoomDjConsole />;
}
