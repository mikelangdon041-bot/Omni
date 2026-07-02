import { ConferenceProvider } from "@/components/conference/ConferenceContext";

export default async function ConferenceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ConferenceProvider conferenceId={id}>{children}</ConferenceProvider>;
}
