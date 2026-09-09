"use client";

import { useState } from "react";
import Image from "next/image";

import { authClient } from "@/lib/auth/client";

export function SignInForm({
  redirectTo = "/host",
  domainError = false,
}: {
  redirectTo?: string;
  domainError?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    domainError
      ? "Sign in with your Elevenlabs.io email address to continue"
      : null
  );

  async function continueWithGoogle() {
    setError(null);
    setPending(true);
    try {
      // Clear a wrong-domain session only when the user actively retries.
      // Doing this in an effect lets a stale `?error=domain` tab sign out a
      // valid session whenever Next dev/HMR remounts that tab.
      if (domainError) {
        await authClient.signOut().catch(() => {});
      }
      const res = await authClient.signIn.social({
        provider: "google",
        callbackURL: redirectTo,
      });
      if (res?.error) {
        setError(res.error.message ?? "Sign-in failed.");
        setPending(false);
      }
      // On success, signIn.social redirects the browser to Google.
    } catch {
      setError("Sign-in failed.");
      setPending(false);
    }
  }

  return (
    <section className="card rise w-full max-w-md p-7 text-center sm:p-9">
      <p className="eyebrow mb-3">Host console</p>
      <h1 className="display text-xl sm:text-2xl">Sign in</h1>
      <p className="mx-auto mt-3 max-w-xs text-sm text-[var(--dark-gray)]">
        Sign in with your <span className="font-medium">elevenlabs.io</span>{" "}
        email.
      </p>

      <button
        type="button"
        onClick={continueWithGoogle}
        disabled={pending}
        className="btn-primary mx-auto mt-6 inline-flex h-11 w-full max-w-sm items-center justify-center gap-2 px-5 text-sm"
      >
        {pending ? (
          "Redirecting…"
        ) : (
          <>
            Continue with
            <Image
              src="/brand/logo-white.png"
              alt="ElevenLabs"
              width={150}
              height={26}
              className="h-3.5 w-auto"
            />
          </>
        )}
      </button>

      {error && (
        <p className="mt-4 text-sm text-[var(--destructive)]">{error}</p>
      )}
    </section>
  );
}
