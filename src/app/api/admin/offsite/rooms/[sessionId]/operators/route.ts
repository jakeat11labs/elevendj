import { z } from "zod";
import { and, eq } from "drizzle-orm";

import { requireAdmin } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
import { db } from "@/lib/db/client";
import {
  grantRoomOperator,
  listAllUsers,
  listRoomOperatorGrants,
  revokeRoomOperatorGrant,
  userExists,
} from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sessionId: string }> };
const bodySchema = z.object({ userId: z.string().uuid() });

async function requireRoom(sessionId: string) {
  const [room] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(eq(sessions.id, sessionId), eq(sessions.source, "integration"))
    )
    .limit(1);
  if (!room) {
    throw new AppError(404, "session_not_found", "Offsite room not found.");
  }
}

export const GET = route(async (_request: Request, context: Ctx) => {
  await requireAdmin();
  const { sessionId } = await context.params;
  await requireRoom(sessionId);
  const [grants, users] = await Promise.all([
    listRoomOperatorGrants(sessionId),
    listAllUsers(),
  ]);
  return json({
    grants,
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
    })),
  });
});

export const POST = route(async (request: Request, context: Ctx) => {
  const admin = await requireAdmin();
  const { sessionId } = await context.params;
  await requireRoom(sessionId);
  const { userId } = await parseBody(request, bodySchema, {
    message: "Invalid operator grant.",
  });
  if (!(await userExists(userId))) {
    throw new AppError(404, "user_not_found", "User not found.");
  }
  const grant = await grantRoomOperator({
    sessionId,
    userId,
    grantedBy: admin.id,
  });
  return json({ grant }, { status: 201 });
});

export const DELETE = route(async (request: Request, context: Ctx) => {
  await requireAdmin();
  const { sessionId } = await context.params;
  await requireRoom(sessionId);
  const { userId } = await parseBody(request, bodySchema, {
    message: "Invalid operator grant.",
  });
  await revokeRoomOperatorGrant(sessionId, userId);
  return json({ ok: true });
});
