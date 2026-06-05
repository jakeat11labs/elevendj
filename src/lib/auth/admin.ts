import "server-only";

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/server";
import { upsertUser } from "@/lib/db";
import { AppError } from "@/lib/errors";

/** Only ElevenLabs Google accounts may host. Enforced in code (not Neon-side). */
export const ALLOWED_EMAIL_DOMAIN = "elevenlabs.io";

export function isAllowedEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export type SessionUser = {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
};

/**
 * Reads the Neon Auth session, enforces the @elevenlabs.io domain, and mirrors
 * the user into our own `users` table on first sign-in (auto-provision).
 * Returns null for no session or a non-ElevenLabs email.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const { data } = await auth.getSession();
  const su = data?.user;
  if (!su?.email) {
    return null;
  }

  const email = su.email.toLowerCase();
  if (!isAllowedEmail(email)) {
    return null;
  }

  const u = await upsertUser({
    email,
    neonAuthId: su.id ?? null,
    displayName: su.name ?? null,
  });

  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    // DB flag is the source of truth; ADMIN_EMAILS is a bootstrap fallback so
    // the first admin can always get in even before the flag is set.
    isAdmin: u.isAdmin || ADMIN_EMAILS.includes(email),
  };
}

/** API guard: 401 (AppError) if not a signed-in ElevenLabs host. */
export async function requireHost(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AppError(
      401,
      "unauthorized",
      "Sign in with your ElevenLabs Google account to host."
    );
  }
  return user;
}

/** Page guard: redirect non-members to /sign-in (catches wrong-domain sessions
 *  that pass the middleware, which can't read the email). */
export async function requireMember(): Promise<SessionUser> {
  let user: SessionUser | null = null;
  try {
    user = await getCurrentUser();
  } catch {
    user = null;
  }
  if (!user) {
    redirect("/sign-in?error=domain");
  }
  return user;
}

/** API guard: 403 if the signed-in host is not an admin. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireHost();
  if (!user.isAdmin) {
    throw new AppError(403, "forbidden", "Admin access required.");
  }
  return user;
}

/** Page guard: redirect non-admins to /host (and unauthenticated to sign-in). */
export async function requireAdminMember(): Promise<SessionUser> {
  const user = await requireMember();
  if (!user.isAdmin) {
    redirect("/host");
  }
  return user;
}
