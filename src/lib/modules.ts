import type { CSSProperties } from "react";
import {
  LayoutDashboard,
  Mic,
  Sparkles,
  CalendarClock,
  MapPin,
  Presentation,
  type LucideIcon,
} from "lucide-react";

// Single source of truth for Omni's modules: drives the app-switcher drawer,
// the dashboard launcher, and per-module theming. Each module shares the global
// shell + component library but carries its own accent + gradient identity.
export interface ModuleTheme {
  accent: string;
  accentHover: string;
  accentSoft: string;
  accentFg: string;
  gradFrom: string;
  gradVia: string;
  gradTo: string;
}

export interface ModuleDef {
  slug: string; // route under (app); "" is the dashboard home
  href: string;
  label: string;
  icon: LucideIcon;
  blurb: string;
  ready: boolean;
  theme: ModuleTheme;
}

export const MODULES: ModuleDef[] = [
  {
    slug: "",
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    blurb: "Your medical-affairs command center.",
    ready: true,
    theme: t("#5a4ff3", "#4a3fde", "#ebe9fe", "#5a4ff3", "#8b5cf6", "#ff6a4d"),
  },
  {
    slug: "interview-prep",
    href: "/interview-prep",
    label: "Interview Prep",
    icon: Mic,
    blurb: "Upload a recording, get a transcript and a nested summary.",
    ready: true,
    theme: t("#4f46e5", "#4338ca", "#e0e7ff", "#4f46e5", "#7c3aed", "#db2777"),
  },
  {
    slug: "territory-planning",
    href: "/territory-planning",
    label: "Territory Planning",
    icon: MapPin,
    blurb: "Manage your KOLs, outreach cycles, and engagement.",
    ready: true,
    theme: t("#0d9488", "#0f766e", "#ccfbf1", "#14b8a6", "#0d9488", "#0891b2"),
  },
  {
    slug: "insights",
    href: "/insights",
    label: "Insights",
    icon: Sparkles,
    blurb: "Capture and distill field insights.",
    ready: false,
    theme: t("#d97706", "#b45309", "#fef3c7", "#f59e0b", "#f97316", "#ea580c"),
  },
  {
    slug: "meeting-prep",
    href: "/meeting-prep",
    label: "Meeting Prep",
    icon: CalendarClock,
    blurb: "Brief yourself before every KOL meeting.",
    ready: false,
    theme: t("#0284c7", "#0369a1", "#e0f2fe", "#0ea5e9", "#3b82f6", "#6366f1"),
  },
  {
    slug: "conference-planning",
    href: "/conference-planning",
    label: "Conference Planning",
    icon: Presentation,
    blurb: "Plan and execute conference coverage.",
    ready: false,
    theme: t("#e11d48", "#be123c", "#ffe4e6", "#f43f5e", "#ec4899", "#d946ef"),
  },
];

function t(
  accent: string,
  accentHover: string,
  accentSoft: string,
  gradFrom: string,
  gradVia: string,
  gradTo: string,
): ModuleTheme {
  return {
    accent,
    accentHover,
    accentSoft,
    accentFg: "#ffffff",
    gradFrom,
    gradVia,
    gradTo,
  };
}

// Match a pathname to its module (longest non-root prefix wins).
export function moduleForPath(pathname: string): ModuleDef {
  if (pathname === "/") return MODULES[0];
  const match = MODULES.filter((m) => m.slug && pathname.startsWith(m.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  return match || MODULES[0];
}

export function getModule(slug: string): ModuleDef | undefined {
  return MODULES.find((m) => m.slug === slug);
}

// CSS custom properties to apply a module's theme to a subtree.
export function moduleThemeVars(theme: ModuleTheme): CSSProperties {
  return {
    "--accent": theme.accent,
    "--accent-hover": theme.accentHover,
    "--accent-soft": theme.accentSoft,
    "--accent-fg": theme.accentFg,
    "--grad-from": theme.gradFrom,
    "--grad-via": theme.gradVia,
    "--grad-to": theme.gradTo,
  } as CSSProperties;
}
