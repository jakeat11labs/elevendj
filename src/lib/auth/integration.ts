import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { integrationClients } from "@/lib/db/schema";
import type { IntegrationClientRow } from "@/lib/db/schema";
import {
  integrationPrefixFromSecret,
  parseIntegrationBearer,
  verifyCredential,
} from "@/lib/auth/credentials";
import { AppError } from "@/lib/errors";

export type IntegrationClient = {
  id: string;
  name: string;
  ownerHostId: string;
  credentialPrefix: string;
};

function mapClient(row: IntegrationClientRow): IntegrationClient {
  return {
    id: row.id,
    name: row.name,
    ownerHostId: row.ownerHostId,
    credentialPrefix: row.credentialPrefix,
  };
}

/** Authenticate an Integration API request from the Authorization header. */
export async function requireIntegrationClient(
  request: Request
): Promise<IntegrationClient> {
  const secret = parseIntegrationBearer(
    request.headers.get("authorization")
  );
  if (!secret) {
    throw new AppError(
      401,
      "unauthorized",
      "Missing or invalid integration Authorization header."
    );
  }

  const prefix = integrationPrefixFromSecret(secret);
  if (!prefix) {
    throw new AppError(401, "unauthorized", "Invalid integration credential.");
  }

  const [row] = await db
    .select()
    .from(integrationClients)
    .where(
      and(
        eq(integrationClients.credentialPrefix, prefix),
        eq(integrationClients.enabled, true)
      )
    )
    .limit(1);

  if (!row || !verifyCredential(secret, row.credentialHash)) {
    throw new AppError(401, "unauthorized", "Invalid integration credential.");
  }

  // Best-effort last-used stamp; never block the request on it.
  void db
    .update(integrationClients)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(integrationClients.id, row.id))
    .catch(() => undefined);

  return mapClient(row);
}
