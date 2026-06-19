import { requireHost } from "@/lib/auth/admin";
import { json, route } from "@/lib/api";
import { getActiveSessionForHost, regeneratePublicCode } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Issue a fresh public request-link code for the host's active session. */
export const POST = route(async () => {
  const user = await requireHost();
  const active = await getActiveSessionForHost(user.id);
  const session = await regeneratePublicCode(user.id, active.id);
  return json({ ok: true, session });
});
