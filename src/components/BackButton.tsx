"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// Goes back to the previous page in history, unless `href` is given — some
// callers need a guaranteed destination (the piece can be reached by a deep
// link or a chat handoff, not just by browsing from the list it belongs to,
// and history.back() from there lands wherever the visit started instead).
export function BackButton({ label = "Back", href }: { label?: string; href?: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => (href ? router.push(href) : router.back())}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink"
    >
      <ArrowLeft size={15} /> {label}
    </button>
  );
}
