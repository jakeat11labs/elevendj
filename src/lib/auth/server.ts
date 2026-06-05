import { createNeonAuth } from "@neondatabase/auth/next/server";

const baseUrl = process.env.NEON_AUTH_BASE_URL;
const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET;

if (!baseUrl || baseUrl === "provisioning") {
  throw new Error("NEON_AUTH_BASE_URL is not set (Neon Auth still provisioning?)");
}
if (!cookieSecret || cookieSecret.length < 32) {
  throw new Error(
    "NEON_AUTH_COOKIE_SECRET must be set and at least 32 characters"
  );
}

export const auth = createNeonAuth({
  baseUrl,
  cookies: {
    secret: cookieSecret,
    sessionDataTtl: 300,
    // CRITICAL: Neon Auth defaults to "strict", which drops the OAuth challenge
    // cookie on the cross-site return from Google → infinite sign-in loop.
    sameSite: "lax",
  },
  logLevel: "warn",
});
