"use client";

// Writing Studio home: library of everything you've written/edited here,
// plus the two entry modes (edit something I have / write from scratch).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PenLine, Plus, Search, Settings2, Trash2 } from "lucide-react";
import { ModuleHero } from "@/components/ui/ModuleHero";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/Feedback";
import { SettingsModal } from "@/components/writer/SettingsModal";
import {
  useUserId,
  useWriterDocs,
  useWriterSettings,
  useWriterStyles,
} from "@/lib/writer/hooks";
import {
  DOC_TYPES,
  docTypeLabel,
  htmlToPlain,
  type DocMode,
  type DocType,
} from "@/lib/writer/types";

// Per-type color identity so the library reads at a glance.
const TYPE_COLORS: Record<DocType, { badge: string; edge: string }> = {
  email: { badge: "bg-sky-100 text-sky-700", edge: "hover:border-sky-400/60" },
  document: { badge: "bg-violet-100 text-violet-700", edge: "hover:border-violet-400/60" },
  message: { badge: "bg-teal-100 text-teal-700", edge: "hover:border-teal-400/60" },
  social: { badge: "bg-rose-100 text-rose-700", edge: "hover:border-rose-400/60" },
  summary: { badge: "bg-amber-100 text-amber-700", edge: "hover:border-amber-400/60" },
  other: { badge: "bg-[var(--accent-soft)] text-[var(--accent)]", edge: "hover:border-[var(--accent)]/50" },
};

export default function WritingStudioPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { userId } = useUserId();
  const { docs, loading, add, remove } = useWriterDocs(userId);
  const { settings, save: saveSettings } = useWriterSettings(userId);
  const { styles, add: addStyle, update: updateStyle, remove: removeStyle } =
    useWriterStyles(userId);

  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (typeFilter !== "all" && d.doc_type !== typeFilter) return false;
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        d.subject.toLowerCase().includes(q) ||
        htmlToPlain(d.content).toLowerCase().includes(q)
      );
    });
  }, [docs, query, typeFilter]);

  async function createDoc(docType: DocType, mode: DocMode) {
    const doc = await add({ doc_type: docType, mode });
    if (doc) router.push(`/writing-studio/${doc.id}`);
  }

  return (
    <>
      <ModuleHero
        eyebrow="Writing Studio"
        title="Say it better."
        subtitle="Hand me a rough draft to polish, or a blank page and a goal — in your voice, with your rules."
        icon={PenLine}
        stats={[
          { label: "Pieces", value: docs.length },
          { label: "Styles & voices", value: styles.length },
        ]}
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="!border-white/40 !bg-white/15 !text-white hover:!bg-white/25"
              onClick={() => setShowSettings(true)}
            >
              <Settings2 size={16} /> Settings
            </Button>
            <Button
              className="!bg-white !text-[var(--accent)] hover:!bg-white/90"
              onClick={() => setShowNew(true)}
            >
              <Plus size={16} /> New piece
            </Button>
          </div>
        }
      />

      {/* Search + filter */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your writing…"
            className="pl-9"
          />
        </div>
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="sm:w-48"
        >
          <option value="all">All types</option>
          {DOC_TYPES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm text-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={docs.length === 0 ? "Nothing here yet" : "No matches"}
          hint={
            docs.length === 0
              ? "Start with an email you need to send — paste your rough version or describe what you need."
              : "Try a different search or filter."
          }
          action={
            docs.length === 0 ? (
              <Button onClick={() => setShowNew(true)}>
                <Plus size={16} /> New piece
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filtered.map((d) => (
            <li
              key={d.id}
              className={`group cursor-pointer rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${TYPE_COLORS[d.doc_type]?.edge || ""}`}
              onClick={() => router.push(`/writing-studio/${d.id}`)}
            >
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TYPE_COLORS[d.doc_type]?.badge || "bg-[var(--accent-soft)] text-[var(--accent)]"}`}
                >
                  {docTypeLabel(d.doc_type)}
                </span>
                <span className="text-xs text-muted">
                  {new Date(d.updated_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <span className="flex-1" />
                <button
                  className="rounded p-1 text-muted opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (
                      await confirm({
                        title: "Delete this piece?",
                        message: "All versions are removed too.",
                        confirmLabel: "Delete",
                        danger: true,
                      })
                    )
                      await remove(d.id);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <p className="truncate text-sm font-medium">
                {d.title || d.subject || "Untitled"}
              </p>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
                {htmlToPlain(d.content) || htmlToPlain(d.original) || "Empty"}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* New piece: type + mode */}
      <NewPieceModal open={showNew} onClose={() => setShowNew(false)} onCreate={createDoc} />

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        saveSettings={saveSettings}
        styles={styles}
        addStyle={addStyle}
        updateStyle={updateStyle}
        removeStyle={removeStyle}
      />
    </>
  );
}

function NewPieceModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (t: DocType, m: DocMode) => Promise<void>;
}) {
  const [docType, setDocType] = useState<DocType>("email");
  const [creating, setCreating] = useState<DocMode | null>(null);

  return (
    <Modal open={open} onClose={onClose} title="What are we writing?">
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {DOC_TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => setDocType(t.key)}
            className={`rounded-xl border p-3 text-left transition ${
              docType === t.key
                ? "border-[var(--accent)] bg-[var(--accent-soft)]/60 shadow-sm"
                : `border-border ${TYPE_COLORS[t.key]?.edge || ""}`
            }`}
          >
            <span
              className={`mb-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TYPE_COLORS[t.key]?.badge || ""}`}
            >
              {t.label}
            </span>
            <p className="text-[11px] leading-snug text-muted">{t.blurb}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          variant="secondary"
          disabled={!!creating}
          onClick={async () => {
            setCreating("edit");
            await onCreate(docType, "edit");
          }}
        >
          {creating === "edit" ? "Opening…" : "I have a draft — polish it"}
        </Button>
        <Button
          disabled={!!creating}
          onClick={async () => {
            setCreating("create");
            await onCreate(docType, "create");
          }}
        >
          {creating === "create" ? "Opening…" : "Write it from scratch"}
        </Button>
      </div>
    </Modal>
  );
}
