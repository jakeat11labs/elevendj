import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { requiredEnv } from "@/lib/env";
import * as schema from "@/lib/db/schema";

// Pooled HTTP connection — ideal for serverless/Fluid Compute one-shot queries.
// (Drizzle-kit migrations use the UNPOOLED url; see drizzle.config.ts.)
const sql = neon(requiredEnv("NEON_DATABASE_URL"));

export const db = drizzle(sql, { schema });

export { schema };
