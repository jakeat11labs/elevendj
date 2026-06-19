import { requireAdmin } from "@/lib/auth/admin";
import { json, route } from "@/lib/api";
import { adminListSessionsForUser } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    await requireAdmin();
    const { id } = await context.params;
    const sessions = await adminListSessionsForUser(id);
    return json({ sessions });
  }
);
