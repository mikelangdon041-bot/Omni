import { redirect } from "next/navigation";
import { getSessionProfile, isAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { AdminUsers } from "@/components/admin/AdminUsers";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const { profile } = await getSessionProfile();
  if (!isAdmin(profile)) redirect("/");

  return (
    <>
      <PageHeader
        title="Admin"
        subtitle="Manage the people in your company."
      />
      <AdminUsers />
    </>
  );
}
