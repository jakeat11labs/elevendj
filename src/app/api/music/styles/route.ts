import { musicStyleChoices } from "@/lib/music-styles";

export const dynamic = "force-dynamic";

/** Public, non-secret catalog shared by native and portal request forms. */
export async function GET(request: Request) {
  const seed =
    new URL(request.url).searchParams.get("seed") ||
    new Date().toISOString().slice(0, 10);
  return Response.json(musicStyleChoices(seed), {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
