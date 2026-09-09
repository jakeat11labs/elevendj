import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
import {
  approvePlayerPairing,
  listPendingPairings,
  rejectPlayerPairing,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireAdmin();
  const pendingPairings = await listPendingPairings();
  return json({ pendingPairings });
});

const decideSchema = z.object({
  pairingId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  sessionId: z.string().uuid().nullable().optional(),
});

export const POST = route(async (request: Request) => {
  const admin = await requireAdmin();
  const body = await parseBody(request, decideSchema, {
    message: "Invalid pairing decision.",
  });

  if (body.action === "reject") {
    await rejectPlayerPairing(body.pairingId, admin.id);
    return json({ ok: true });
  }

  const device = await approvePlayerPairing({
    pairingId: body.pairingId,
    sessionId: body.sessionId ?? null,
    approvedBy: admin.id,
  });
  return json({ ok: true, device });
});
