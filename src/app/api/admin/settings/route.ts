import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import {
  getActiveSessionForHost,
  setAutoDj,
  setMasterVolume,
  setOrbColorway,
  setRequestsOpen,
  setStationIdEnabled,
  setStationIdHostName,
  setStationIdPersonalize,
} from "@/lib/db";
import { COLORWAY_NAMES } from "@/components/orb/colorways";
import { AppError, errorResponse } from "@/lib/errors";
import { ensureStationIdPool } from "@/lib/station-id-pool";

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
    // Station ID: enable the auto radio-ID jingle, opt into personalization,
    // and the host/room name woven into it (empty string clears it).
    stationIdEnabled: z.boolean().optional(),
    stationIdPersonalize: z.boolean().optional(),
    stationIdHostName: z.string().trim().max(60).optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "No settings provided.",
  });

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
    if (parsed.data.stationIdPersonalize !== undefined) {
      await setStationIdPersonalize(user.id, parsed.data.stationIdPersonalize);
    }
    if (parsed.data.stationIdHostName !== undefined) {
      await setStationIdHostName(user.id, parsed.data.stationIdHostName);
    }
    if (parsed.data.stationIdEnabled !== undefined) {
      await setStationIdEnabled(user.id, parsed.data.stationIdEnabled);
      // Start warming the pool immediately so the first ID is ready well before
      // it's due. Best-effort — never block the settings response on generation.
      if (parsed.data.stationIdEnabled) {
        const active = await getActiveSessionForHost(user.id);
        void ensureStationIdPool(active.id).catch((error) => {
          console.error("Station ID pool warm-up failed", error);
        });
      }
    }

    return Response.json(
      {
        ok: true,
        requestsOpen: parsed.data.requestsOpen,
        autoDj: parsed.data.autoDj,
        orbColorway: parsed.data.orbColorway,
        masterVolume: parsed.data.masterVolume,
        stationIdEnabled: parsed.data.stationIdEnabled,
        stationIdPersonalize: parsed.data.stationIdPersonalize,
        stationIdHostName: parsed.data.stationIdHostName,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
