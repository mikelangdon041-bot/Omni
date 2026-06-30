import { ModuleTheme } from "@/components/ModuleTheme";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ModuleTheme slug="conference-planning">{children}</ModuleTheme>;
}
