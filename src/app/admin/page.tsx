import { AdminConsole } from "@/app/admin/admin-console";
import { requireAdminMember } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireAdminMember();
  return <AdminConsole currentUserId={user.id} />;
}
