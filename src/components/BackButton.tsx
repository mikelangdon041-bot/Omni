"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// Goes back to the previous page in history (not a fixed route).
export function BackButton({ label = "Back" }: { label?: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink"
    >
      <ArrowLeft size={15} /> {label}
    </button>
  );
}
