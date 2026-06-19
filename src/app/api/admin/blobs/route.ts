import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
import { deleteBlob, isTrackPath, listBlobsPage } from "@/lib/admin-blob";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (request: Request) => {
  await requireAdmin();
  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  const page = await listBlobsPage(cursor);
  return json(page);
});

const deleteSchema = z.object({
  pathname: z.string().min(1),
});

export const DELETE = route(async (request: Request) => {
  await requireAdmin();
  const { pathname } = await parseBody(request, deleteSchema, {
    message: "Invalid blob path.",
  });
  if (!isTrackPath(pathname)) {
    throw new AppError(400, "invalid_request", "Invalid blob path.");
  }
  const result = await deleteBlob(pathname);
  return json(result);
});
