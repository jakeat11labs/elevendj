import "server-only";

import { desc, eq } from "drizzle-orm";

import { issueIntegrationCredential } from "@/lib/auth/credentials";
import { db } from "@/lib/db/client";
import { integrationClients } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { dbCall, toIso } from "./internal";

export type IntegrationClientSummary = {
  id: string;
  name: string;
  ownerHostId: string;
  credentialPrefix: string;
  enabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
};

export async function listIntegrationClients(): Promise<
  IntegrationClientSummary[]
> {
  return dbCall(async () => {
    const rows = await db
      .select()
      .from(integrationClients)
      .orderBy(desc(integrationClients.createdAt));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      ownerHostId: row.ownerHostId,
      credentialPrefix: row.credentialPrefix,
      enabled: row.enabled,
      lastUsedAt: toIso(row.lastUsedAt),
      createdAt: toIso(row.createdAt) as string,
    }));
  });
}

/** Create a client and return the plaintext secret once. */
export async function createIntegrationClient(input: {
  name: string;
  ownerHostId: string;
  createdBy: string;
}): Promise<{ client: IntegrationClientSummary; secret: string }> {
  return dbCall(async () => {
    const cred = issueIntegrationCredential();
    const [row] = await db
      .insert(integrationClients)
      .values({
        name: input.name.trim().slice(0, 80),
        ownerHostId: input.ownerHostId,
        createdBy: input.createdBy,
        credentialHash: cred.hash,
        credentialPrefix: cred.prefix,
        enabled: true,
      })
      .returning();
    return {
      client: {
        id: row.id,
        name: row.name,
        ownerHostId: row.ownerHostId,
        credentialPrefix: row.credentialPrefix,
        enabled: row.enabled,
        lastUsedAt: null,
        createdAt: toIso(row.createdAt) as string,
      },
      secret: cred.secret,
    };
  });
}

/** Rotate credentials; returns the new plaintext secret once. */
export async function rotateIntegrationClient(
  id: string
): Promise<{ client: IntegrationClientSummary; secret: string }> {
  return dbCall(async () => {
    const cred = issueIntegrationCredential();
    const [row] = await db
      .update(integrationClients)
      .set({
        credentialHash: cred.hash,
        credentialPrefix: cred.prefix,
        updatedAt: new Date(),
      })
      .where(eq(integrationClients.id, id))
      .returning();
    if (!row) {
      throw new AppError(404, "not_found", "Integration client not found.");
    }
    return {
      client: {
        id: row.id,
        name: row.name,
        ownerHostId: row.ownerHostId,
        credentialPrefix: row.credentialPrefix,
        enabled: row.enabled,
        lastUsedAt: toIso(row.lastUsedAt),
        createdAt: toIso(row.createdAt) as string,
      },
      secret: cred.secret,
    };
  });
}

export async function setIntegrationClientEnabled(
  id: string,
  enabled: boolean
): Promise<IntegrationClientSummary> {
  return dbCall(async () => {
    const [row] = await db
      .update(integrationClients)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(integrationClients.id, id))
      .returning();
    if (!row) {
      throw new AppError(404, "not_found", "Integration client not found.");
    }
    return {
      id: row.id,
      name: row.name,
      ownerHostId: row.ownerHostId,
      credentialPrefix: row.credentialPrefix,
      enabled: row.enabled,
      lastUsedAt: toIso(row.lastUsedAt),
      createdAt: toIso(row.createdAt) as string,
    };
  });
}

export async function getIntegrationClientById(id: string) {
  return dbCall(async () => {
    const [row] = await db
      .select()
      .from(integrationClients)
      .where(eq(integrationClients.id, id))
      .limit(1);
    return row ?? null;
  });
}
