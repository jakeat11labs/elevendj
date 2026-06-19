import { requireAdmin } from "@/lib/auth/admin";
import { json, route } from "@/lib/api";
import { getBlobStats } from "@/lib/admin-blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireAdmin();
  const stats = await getBlobStats();
  return json(stats);
});
