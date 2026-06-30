import Link from "next/link";
import { Shield } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { SignOutButton } from "@/components/SignOutButton";
import { SettingsForm } from "@/components/SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name, role, org_id")
    .eq("id", user?.id || "")
    .single();

  let companyName = "";
  if (profile?.org_id) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", profile.org_id)
      .single();
    companyName = org?.name || "";
  }

  const isAdmin = profile?.role === "admin" || profile?.role === "owner";
  const isOwner = profile?.role === "owner";

  return (
    <>
      <PageHeader title="Settings" subtitle="Your account and company." />

      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
            Account
          </h2>
          <p className="mb-4 text-sm text-muted">
            Username <span className="font-medium text-ink">@{profile?.username}</span>{" "}
            · Role <span className="font-medium text-ink">{profile?.role}</span>
          </p>
          {user && (
            <SettingsForm
              userId={user.id}
              orgId={profile?.org_id || null}
              initialDisplayName={profile?.display_name || ""}
              initialCompany={companyName}
              canRenameCompany={isOwner}
            />
          )}
        </section>

        {isAdmin && (
          <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              Company
            </h2>
            <Link
              href="/admin"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-ink transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <Shield size={16} /> Manage members
            </Link>
          </section>
        )}

        <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            App settings
          </h2>
          <p className="text-sm text-muted">
            App-specific preferences live inside each app (more coming soon).
          </p>
        </section>

        <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
            Session
          </h2>
          <SignOutButton />
        </section>
      </div>
    </>
  );
}
