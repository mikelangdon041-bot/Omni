import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/AppHeader";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { FeedbackProvider } from "@/components/ui/Feedback";
import { PageContainer } from "@/components/PageContainer";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name, role")
    .eq("id", user.id)
    .single();

  const username =
    profile?.display_name ||
    profile?.username ||
    (user.user_metadata?.username as string) ||
    "MSL";

  const isAdmin = profile?.role === "admin" || profile?.role === "owner";
  const impersonating = (await cookies()).has("omni-admin-return");

  return (
    <FeedbackProvider>
      <div className="flex min-h-full flex-1 flex-col">
        {impersonating && (
          <ImpersonationBanner username={profile?.username || username} />
        )}
        <AppHeader username={username} isAdmin={isAdmin} />
        <main className="flex-1">
          <PageContainer>{children}</PageContainer>
        </main>
      </div>
    </FeedbackProvider>
  );
}
