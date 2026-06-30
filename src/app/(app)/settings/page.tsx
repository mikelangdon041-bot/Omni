import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { SignOutButton } from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name")
    .eq("id", user?.id || "")
    .single();

  return (
    <>
      <PageHeader title="Settings" subtitle="Your account and app preferences." />

      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
            Account
          </h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">Username</dt>
              <dd className="text-sm font-medium">{profile?.username || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Display name</dt>
              <dd className="text-sm font-medium">
                {profile?.display_name || "—"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
            Session
          </h2>
          <SignOutButton />
        </section>

        <p className="text-xs text-muted">
          More preferences (notifications, profile editing) are coming soon.
        </p>
      </div>
    </>
  );
}
