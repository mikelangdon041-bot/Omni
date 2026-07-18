"use client";

// Slide Studio home: your decks and templates, the full-page new-deck flow,
// and the zero-design-loss Touch-up mode for existing files.

import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FileText,
  FileUp,
  LayoutTemplate,
  MonitorPlay,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { ModuleHero } from "@/components/ui/ModuleHero";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Feedback";
import { SlideCanvas } from "@/components/slides/SlideCanvas";
import { useDecks, useUserId } from "@/lib/slides/hooks";
import type { DeckSource, SlideDeck } from "@/lib/slides/types";

const SOURCE_BADGE: Record<DeckSource, { label: string; cls: string; icon?: React.ReactNode }> = {
  topic: { label: "From topic", cls: "bg-fuchsia-100 text-fuchsia-700", icon: <Sparkles size={10} /> },
  document: { label: "From document", cls: "bg-sky-100 text-sky-700", icon: <FileText size={10} /> },
  import: { label: "Imported", cls: "bg-emerald-100 text-emerald-700", icon: <FileUp size={10} /> },
  template: { label: "From template", cls: "bg-violet-100 text-violet-700", icon: <LayoutTemplate size={10} /> },
  scratch: { label: "Built by hand", cls: "bg-amber-100 text-amber-700" },
};

export default function SlideStudioPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { userId } = useUserId();
  const { decks, loading, remove } = useDecks(userId);

  const templates = decks.filter((d) => d.is_template);
  const regular = decks.filter((d) => !d.is_template);

  return (
    <>
      <ModuleHero
        eyebrow="Slide Studio"
        title="Decks worth presenting."
        subtitle="Build from a topic or document, polish every slide, script it, and rehearse with a coach in your corner."
        icon={MonitorPlay}
        stats={[
          { label: "Decks", value: regular.length },
          { label: "Templates", value: templates.length },
        ]}
        action={
          <div className="flex gap-2">
            <Link
              href="/slide-studio/touch-up"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/40 bg-white/15 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/25"
            >
              <Pencil size={16} /> Touch-up a file
            </Link>
            <Link
              href="/slide-studio/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-[var(--accent)] shadow-sm transition hover:bg-white/90"
            >
              <Plus size={16} /> New deck
            </Link>
          </div>
        }
      />

      {loading ? (
        <p className="py-16 text-center text-sm text-muted">Loading…</p>
      ) : decks.length === 0 ? (
        <EmptyState
          title="No decks yet"
          hint="Start from a topic, a document, or import an existing .pptx to remix."
          action={
            <Button onClick={() => router.push("/slide-studio/new")}>
              <Plus size={16} /> New deck
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          <DeckGrid
            title="Decks"
            decks={regular}
            onOpen={(id) => router.push(`/slide-studio/${id}`)}
            onDelete={async (d) => {
              if (
                await confirm({
                  title: `Delete "${d.title}"?`,
                  message: "Versions and practice runs are removed too.",
                  confirmLabel: "Delete",
                  danger: true,
                })
              )
                await remove(d.id);
            }}
          />
          {templates.length > 0 && (
            <DeckGrid
              title="Templates (usable in Conference Post-Con decks too)"
              decks={templates}
              onOpen={(id) => router.push(`/slide-studio/${id}`)}
              onDelete={async (d) => {
                if (
                  await confirm({
                    title: `Delete template "${d.title}"?`,
                    confirmLabel: "Delete",
                    danger: true,
                  })
                )
                  await remove(d.id);
              }}
            />
          )}
        </div>
      )}
    </>
  );
}

function DeckGrid({
  title,
  decks,
  onOpen,
  onDelete,
}: {
  title: string;
  decks: SlideDeck[];
  onOpen: (id: string) => void;
  onDelete: (d: SlideDeck) => void;
}) {
  if (decks.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted">
        {title.startsWith("Templates") && <LayoutTemplate size={13} />}
        {title}
      </h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {decks.map((d) => {
          const badge = SOURCE_BADGE[d.source] || SOURCE_BADGE.scratch;
          return (
            <li
              key={d.id}
              className="group cursor-pointer overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--accent)]/50 hover:shadow-md"
              onClick={() => onOpen(d.id)}
            >
              <div className="pointer-events-none relative border-b border-border bg-canvas p-2">
                {d.slides[0] ? (
                  <SlideCanvas slide={d.slides[0]} theme={d.theme} width={280} />
                ) : (
                  <div className="grid h-[157px] place-items-center text-xs text-muted">
                    Empty deck
                  </div>
                )}
                <span
                  className={`absolute right-3 top-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}
                >
                  {badge.icon}
                  {badge.label}
                </span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.title}</p>
                  <p className="text-xs text-muted">
                    {d.slides.length} slide{d.slides.length === 1 ? "" : "s"} ·{" "}
                    {new Date(d.updated_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <button
                  className="rounded p-1 text-muted opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(d);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
