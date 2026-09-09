import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
import {
  assignPlayerDevice,
  listPlayerDevices,
  revokePlayerDevice,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireAdmin();
  const devices = await listPlayerDevices();
  return json({ devices });
});

const patchSchema = z.object({
  deviceId: z.string().uuid(),
  action: z.enum(["assign", "unassign", "revoke"]),
  sessionId: z.string().uuid().nullable().optional(),
});

export const PATCH = route(async (request: Request) => {
  await requireAdmin();
  const body = await parseBody(request, patchSchema, {
    message: "Invalid device update.",
  });

  if (body.action === "revoke") {
    await revokePlayerDevice(body.deviceId);
    return json({ ok: true });
  }

  const device = await assignPlayerDevice(
    body.deviceId,
    body.action === "assign" ? body.sessionId ?? null : null
  );
  return json({ ok: true, device });
});
