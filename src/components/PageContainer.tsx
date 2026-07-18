"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui";

// Routes that get the full viewport width instead of the standard column.
const FULL_WIDTH_PREFIXES = ["/writing-studio/"];

export function PageContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const fullWidth = FULL_WIDTH_PREFIXES.some((p) => pathname.startsWith(p));
  return (
    <div
      className={cn(
        "mx-auto px-3 py-5 sm:px-8 sm:py-8",
        // 1024px (max-w-5xl) left most of a desktop monitor empty; 1600px
        // tracks the conference tab strip's width so the two align. Writing
        // Studio workspaces go edge to edge.
        fullWidth ? "max-w-none" : "max-w-[1600px]",
      )}
    >
      {children}
    </div>
  );
}
