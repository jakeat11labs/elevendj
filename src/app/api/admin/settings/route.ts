import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import {
  setAutoDj,
  setMasterVolume,
  setOrbColorway,
  setRequestsOpen,
} from "@/lib/db";
import { COLORWAY_NAMES } from "@/components/orb/colorways";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const settingsSchema = z
  .object({
    requestsOpen: z.boolean().optional(),
    autoDj: z.boolean().optional(),
    // Constrained to the colorway registry allowlist — only a known name can be
    // persisted, so the value is safe to map to a texture/CSS reference later.
    orbColorway: z.enum(COLORWAY_NAMES).optional(),
    // Host-controlled room master volume, clamped to 0..1 (DB check is backstop).
    masterVolume: z.number().min(0).max(1).optional(),
  })
  .refine(
    (value) =>
      value.requestsOpen !== undefined ||
      value.autoDj !== undefined ||
      value.orbColorway !== undefined ||
      value.masterVolume !== undefined,
    { message: "No settings provided." }
  );

export async function POST(request: Request) {
  try {
    const user = await requireHost();

    const body = await request.json().catch(() => null);
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "invalid_request", "Invalid settings payload.");
    }

    if (parsed.data.requestsOpen !== undefined) {
      await setRequestsOpen(user.id, parsed.data.requestsOpen);
    }
    if (parsed.data.autoDj !== undefined) {
      await setAutoDj(user.id, parsed.data.autoDj);
    }
    if (parsed.data.orbColorway !== undefined) {
      await setOrbColorway(user.id, parsed.data.orbColorway);
    }
    if (parsed.data.masterVolume !== undefined) {
      await setMasterVolume(user.id, parsed.data.masterVolume);
    }

    return Response.json(
      {
        ok: true,
        requestsOpen: parsed.data.requestsOpen,
        autoDj: parsed.data.autoDj,
        orbColorway: parsed.data.orbColorway,
        masterVolume: parsed.data.masterVolume,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
