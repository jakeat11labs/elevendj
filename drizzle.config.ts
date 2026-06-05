import { defineConfig } from "drizzle-kit";

const url =
  process.env.NEON_DATABASE_URL_UNPOOLED ?? process.env.NEON_DATABASE_URL;

if (!url) {
  throw new Error(
    "NEON_DATABASE_URL_UNPOOLED (or NEON_DATABASE_URL) must be set for drizzle-kit"
  );
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  // pgcrypto is needed for gen_random_bytes() in the public_code default.
  verbose: true,
  strict: true,
});
