import { z } from "zod";

import { json, parseBody, route } from "@/lib/api";
import { createPlayerPairing } from "@/lib/db";
import {
  clientIpFromRequest,
  hashValue,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  deviceName: z.string().trim().min(1).max(60).default("Stage player"),
});

export const POST = route(async (request: Request) => {
  const body = await parseBody(request, schema, {
    message: "Invalid pairing payload.",
  });
  const ipHash = hashValue(clientIpFromRequest(request), "ip");
  const { pairing, secret } = await createPlayerPairing({
    deviceName: body.deviceName,
    ipHash,
  });
  return json(
    {
      pairingId: pairing.id,
      displayCode: pairing.displayCode,
      deviceName: pairing.deviceName,
      expiresAt: pairing.expiresAt,
      // Shown once; the device stores it until approval, then swaps to the cookie.
      secret,
    },
    { status: 201 }
  );
});
