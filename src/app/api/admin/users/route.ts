import { requireAdmin } from "@/lib/auth/admin";
import { json, route } from "@/lib/api";
import { listAllUsers } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireAdmin();
  const users = await listAllUsers();
  return json({ users });
});
