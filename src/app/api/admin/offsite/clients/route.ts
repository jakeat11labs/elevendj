import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
import {
  createIntegrationClient,
  listAllUsers,
  listIntegrationClients,
  rotateIntegrationClient,
  setIntegrationClientEnabled,
} from "@/lib/db";

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

  let ownerHostId = body.ownerHostId ?? admin.id;
  if (!body.ownerHostId) {
    // Prefer the creating admin; fine as funding host for Offsite.
    ownerHostId = admin.id;
  }

  // Validate owner exists when explicitly provided.
  if (body.ownerHostId) {
    const users = await listAllUsers();
    if (!users.some((u) => u.id === body.ownerHostId)) {
      ownerHostId = admin.id;
    }
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
