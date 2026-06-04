import { getRequestByClientToken } from "@/lib/db";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const token = url.searchParams.get("token");

    if (!token) {
      throw new AppError(400, "missing_token", "A client token is required.");
    }

    const status = await getRequestByClientToken(id, token);
    return Response.json(status);
  } catch (error) {
    return errorResponse(error);
  }
}
