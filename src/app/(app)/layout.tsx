import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { UID_HEADER } from "@/lib/supabase/middleware";
import { AppHeader } from "@/components/AppHeader";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { FeedbackProvider } from "@/components/ui/Feedback";
import { PageContainer } from "@/components/PageContainer";
import { ScrollMemory } from "@/components/ScrollMemory";
import { ChatScopeProvider } from "@/components/chat/ChatScope";
import { OmniChat } from "@/components/chat/OmniChat";

// This layout deliberately does NO network work. It used to await
// `getUser()` and then a `profiles` row on every single navigation — two
// sequential Supabase round trips that had to finish before a byte of HTML
// could stream, on top of the `getUser()` the proxy already paid for.
//
// Now the proxy forwards the verified id on a request header (free to read),
// and the header resolves the display name / admin flag client-side through
// the shared, cache-first session hook, which paints instantly from
// localStorage. Server render is pure and immediate.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);
  if (!headerList.get(UID_HEADER)) redirect("/login");

  const impersonating = cookieStore.has("omni-admin-return");

  return (
    <FeedbackProvider>
      <ScrollMemory />
      {/* One chat for the whole suite. Mounted here rather than per app so it
          is in the same place at every scroll position on every page; each page
          registers what it can see through useChatScope. */}
      <ChatScopeProvider>
        <div className="flex min-h-full flex-1 flex-col">
          {impersonating && <ImpersonationBanner />}
          <AppHeader />
          <main className="flex-1">
            <PageContainer>{children}</PageContainer>
          </main>
        </div>
        <OmniChat />
      </ChatScopeProvider>
    </FeedbackProvider>
  );
}
