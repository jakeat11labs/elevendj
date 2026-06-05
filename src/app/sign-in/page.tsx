import { SignInForm } from "./form";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  const { redirect, error } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-center px-5 pb-14 pt-2 sm:px-8">
      <SignInForm redirectTo={redirect ?? "/host"} domainError={error === "domain"} />
    </main>
  );
}
