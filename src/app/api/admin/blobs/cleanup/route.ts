import { requireAdmin } from "@/lib/auth/admin";
import { json, route } from "@/lib/api";
import { cleanupOrphanBlobs } from "@/lib/admin-blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async () => {
  await requireAdmin();
  const result = await cleanupOrphanBlobs();
  return json({ ok: true, ...result });
});
