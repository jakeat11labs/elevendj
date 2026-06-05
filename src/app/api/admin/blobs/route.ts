import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { deleteBlob, isTrackPath, listBlobsPage } from "@/lib/admin-blob";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
    const page = await listBlobsPage(cursor);
    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

const deleteSchema = z.object({
  pathname: z.string().min(1),
});

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => null);
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success || !isTrackPath(parsed.data.pathname)) {
      throw new AppError(400, "invalid_request", "Invalid blob path.");
    }
    const result = await deleteBlob(parsed.data.pathname);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
