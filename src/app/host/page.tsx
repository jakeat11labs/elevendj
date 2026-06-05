import { HostConsole } from "@/app/host/host-console";
import { requireMember } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function HostPage() {
  const user = await requireMember();
  return (
    <HostConsole
      user={{
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
      }}
    />
  );
}
