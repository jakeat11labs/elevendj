import { requireAdmin } from "@/lib/auth/admin";
import { json, route } from "@/lib/api";
import { getOffsiteOverview } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireAdmin();
  const overview = await getOffsiteOverview();
  return json(overview);
});
