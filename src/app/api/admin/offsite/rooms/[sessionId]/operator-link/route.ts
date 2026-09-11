import { requireAdmin } from "@/lib/auth/admin";
import { json, route } from "@/lib/api";
import {
  issueRoomOperatorLink,
  revokeRoomOperatorLinks,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sessionId: string }> };

/** Rotate and return a room-scoped emergency link. Shown once. */
export const POST = route(async (request: Request, context: Ctx) => {
  const admin = await requireAdmin();
  const { sessionId } = await context.params;
  const credential = await issueRoomOperatorLink({
    sessionId,
    createdBy: admin.id,
  });
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  return json({
    url: `${origin}/offsite/control#access=${encodeURIComponent(
      credential.token
    )}`,
    pin: credential.pin,
    expiresAt: credential.expiresAt,
  });
});

export const DELETE = route(async (_request: Request, context: Ctx) => {
  await requireAdmin();
  const { sessionId } = await context.params;
  await revokeRoomOperatorLinks(sessionId);
  return json({ ok: true });
});
