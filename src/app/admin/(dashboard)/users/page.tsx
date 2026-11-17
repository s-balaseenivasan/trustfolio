import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { UserManager } from "@/components/admin/user-manager";
import { requireAdminPage } from "@/server/auth-guard";
import { listUsers } from "@/server/queries/admin";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireAdminPage("ADMIN");
  const users = await listUsers();
  return (
    <>
      <PageHeader title="Users" description="Administrators manage the trust, editors manage content, and portal users have no admin access." />
      <UserManager
        currentUserId={me.id}
        users={users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString() }))}
      />
    </>
  );
}
