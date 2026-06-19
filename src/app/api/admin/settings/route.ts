import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
import {
  getActiveSessionForHost,
  setAutoDj,
  setCrossfadeEnabled,
  setMasterVolume,
  setOrbColorway,
  setRequestsOpen,
  setStationIdEnabled,
  setStationIdHostName,
  setStationIdPersonalize,
} from "@/lib/db";
import { COLORWAY_NAMES } from "@/components/orb/colorways";
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
    // Crossfade between tracks on the stage (radio-style overlap).
    crossfadeEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "No settings provided.",
  });

export const POST = route(async (request: Request) => {
  const user = await requireHost();

  const data = await parseBody(request, settingsSchema, {
    message: "Invalid settings payload.",
  });

  if (data.requestsOpen !== undefined) {
    await setRequestsOpen(user.id, data.requestsOpen);
  }
  if (data.autoDj !== undefined) {
    await setAutoDj(user.id, data.autoDj);
  }
  if (data.orbColorway !== undefined) {
    await setOrbColorway(user.id, data.orbColorway);
  }
  if (data.masterVolume !== undefined) {
    await setMasterVolume(user.id, data.masterVolume);
  }
  if (data.stationIdPersonalize !== undefined) {
    await setStationIdPersonalize(user.id, data.stationIdPersonalize);
  }
  if (data.stationIdHostName !== undefined) {
    await setStationIdHostName(user.id, data.stationIdHostName);
  }
  if (data.crossfadeEnabled !== undefined) {
    await setCrossfadeEnabled(user.id, data.crossfadeEnabled);
  }
  if (data.stationIdEnabled !== undefined) {
    await setStationIdEnabled(user.id, data.stationIdEnabled);
    // Start warming the pool immediately so the first ID is ready well before
    // it's due. Best-effort — never block the settings response on generation.
    if (data.stationIdEnabled) {
      const active = await getActiveSessionForHost(user.id);
      void ensureStationIdPool(active.id).catch((error) => {
        console.error("Station ID pool warm-up failed", error);
      });
    }
  }

  return json({
    ok: true,
    requestsOpen: data.requestsOpen,
    autoDj: data.autoDj,
    orbColorway: data.orbColorway,
    masterVolume: data.masterVolume,
    stationIdEnabled: data.stationIdEnabled,
    stationIdPersonalize: data.stationIdPersonalize,
    stationIdHostName: data.stationIdHostName,
    crossfadeEnabled: data.crossfadeEnabled,
  });
});
