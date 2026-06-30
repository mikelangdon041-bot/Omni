import { getModule, moduleThemeVars } from "@/lib/modules";

// Applies a module's accent + gradient CSS vars to its subtree, so shared
// components reading var(--accent) / var(--grad-*) pick up the module identity.
export function ModuleTheme({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  const mod = getModule(slug);
  return <div style={mod ? moduleThemeVars(mod.theme) : undefined}>{children}</div>;
}
