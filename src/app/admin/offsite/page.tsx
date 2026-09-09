import { OffsiteConsole } from "@/app/admin/offsite/offsite-console";
import { requireAdminMember } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function OffsiteAdminPage() {
  await requireAdminMember();
  return <OffsiteConsole />;
}
