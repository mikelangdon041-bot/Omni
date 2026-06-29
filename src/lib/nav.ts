// Feature areas of Omni. `ready` marks what's actually built this phase.
export interface NavItem {
  href: string;
  label: string;
  icon: string; // single-glyph icon to keep things dependency-free
  ready: boolean;
  blurb: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: "◆",
    ready: true,
    blurb: "Your MSL command center.",
  },
  {
    href: "/interview-prep",
    label: "Interview Prep",
    icon: "◎",
    ready: true,
    blurb: "Upload a recording, get a transcript and a nested summary.",
  },
  {
    href: "/insights",
    label: "Insights",
    icon: "✦",
    ready: false,
    blurb: "Capture and distill field insights.",
  },
  {
    href: "/meeting-prep",
    label: "Meeting Prep",
    icon: "❖",
    ready: false,
    blurb: "Brief yourself before every KOL meeting.",
  },
  {
    href: "/conference-planning",
    label: "Conference Planning",
    icon: "▣",
    ready: false,
    blurb: "Plan and execute conference coverage.",
  },
  {
    href: "/territory-planning",
    label: "Territory Planning",
    icon: "◈",
    ready: false,
    blurb: "Map and prioritize your territory.",
  },
];
