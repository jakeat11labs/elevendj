import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
import {
  createIntegrationClient,
  listIntegrationClients,
  rotateIntegrationClient,
  setIntegrationClientEnabled,
  userExists,
} from "@/lib/db";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  ownerHostId: z.string().uuid().optional(),
});

export const GET = route(async () => {
  await requireAdmin();
  const clients = await listIntegrationClients();
  return json({ clients });
});

export const POST = route(async (request: Request) => {
  const admin = await requireAdmin();
  const body = await parseBody(request, createSchema, {
    message: "Invalid integration client payload.",
  });

  // The owner host funds ElevenLabs generation for this client, so an unknown
  // id is an error rather than something to quietly bill the acting admin for.
  const ownerHostId = body.ownerHostId ?? admin.id;
  if (body.ownerHostId && !(await userExists(body.ownerHostId))) {
    throw new AppError(
      400,
      "owner_not_found",
      "That owner host does not exist."
    );
  }

  const result = await createIntegrationClient({
    name: body.name,
    ownerHostId,
    createdBy: admin.id,
  });

  return json(
    {
      client: result.client,
      // Shown once — never stored or returned again.
      secret: result.secret,
    },
    { status: 201 }
  );
});

const patchSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["rotate", "enable", "disable"]),
});

export const PATCH = route(async (request: Request) => {
  await requireAdmin();
  const body = await parseBody(request, patchSchema, {
    message: "Invalid integration client update.",
  });

  if (body.action === "rotate") {
    const result = await rotateIntegrationClient(body.id);
    return json({ client: result.client, secret: result.secret });
  }

  const client = await setIntegrationClientEnabled(
    body.id,
    body.action === "enable"
  );
  return json({ client });
});
