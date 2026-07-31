"use client";

// Writing Studio home: library of everything you've written/edited here,
// plus the two entry modes (edit something I have / write from scratch).

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckSquare,
  PenLine,
  Plus,
  Search,
  Settings2,
  Square,
  Trash2,
  X,
} from "lucide-react";
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
  dateGroup,
  docTypeEmoji,
  docTypeLabel,
  htmlToPlain,
  type DocType,
  type WriterDoc,
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
  const { docs, loading, add, remove, removeMany } = useWriterDocs(userId);
  const { settings, save: saveSettings } = useWriterSettings(userId);
  const { styles, add: addStyle, update: updateStyle, remove: removeStyle } =
    useWriterStyles(userId);

  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  // The Windows recorder's Ctrl+Shift+W picker has no brief box of its own —
  // it asks what you're writing, then sends you here with `?type=` to do the
  // actual typing, on the one intake box that already knows how to extract
  // from a paste and autosave. Reading it once, off the URL rather than
  // useSearchParams, keeps this page free of a Suspense boundary.
  const launcherHandled = useRef(false);
  const [openingFromLauncher] = useState(
    () =>
      typeof window !== "undefined" &&
      DOC_TYPES.some((t) => t.key === new URLSearchParams(window.location.search).get("type")),
  );

  const allTags = useMemo(
    () => [...new Set(docs.flatMap((d) => d.tags))].sort((a, b) => a.localeCompare(b)),
    [docs],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (typeFilter !== "all" && d.doc_type !== typeFilter) return false;
      if (tagFilter !== "all" && !d.tags.includes(tagFilter)) return false;
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        d.subject.toLowerCase().includes(q) ||
        d.tags.some((t) => t.toLowerCase().includes(q)) ||
        htmlToPlain(d.content).toLowerCase().includes(q)
      );
    });
  }, [docs, query, typeFilter, tagFilter]);

  // Docs arrive newest-first, so walking them in order yields date buckets in
  // order too — no sorting needed, just a header whenever the bucket changes.
  const groups = useMemo(() => {
    const out: { label: string; docs: WriterDoc[] }[] = [];
    for (const d of filtered) {
      const label = dateGroup(d.updated_at);
      const last = out[out.length - 1];
      if (last?.label === label) last.docs.push(d);
      else out.push({ label, docs: [d] });
    }
    return out;
  }, [filtered]);

  function toggleSelected(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }

  function exitSelect() {
    setSelecting(false);
    setSelected([]);
  }

  async function deleteSelected() {
    if (
      await confirm({
        title: `Delete ${selected.length} ${selected.length === 1 ? "piece" : "pieces"}?`,
        message: "All their versions are removed too. This can't be undone.",
        confirmLabel: "Delete",
        danger: true,
      })
    ) {
      await removeMany(selected);
      exitSelect();
    }
  }

  // One entry path: pick what it is, then say what you want in the workspace.
  // (`mode` is legacy — the AI works out polish-vs-write from what you type.)
  // `focus` lands with the caret already in the Draft box — used when nothing
  // asked you to type a brief first (this launcher, or "New piece" itself).
  async function createDoc(docType: DocType, focus = false) {
    const doc = await add({ doc_type: docType, mode: "create" });
    if (doc) router.push(`/writing-studio/${doc.id}${focus ? "?new=1" : ""}`);
  }

  // Arrived via the desktop app's picker: skip the modal, skip the library,
  // go straight to a fresh piece of the type that was clicked.
  useEffect(() => {
    if (launcherHandled.current || !userId) return;
    const type = new URLSearchParams(window.location.search).get("type");
    if (!type || !DOC_TYPES.some((t) => t.key === type)) return;
    launcherHandled.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    // Already true from the lazy initializer above, which reads the same
    // param — setting it again here would be a synchronous setState inside an
    // effect, which is exactly the pattern that causes a cascading extra
    // render mid-mount.
    void createDoc(type as DocType, true);
    // createDoc is stable enough for this one-shot effect; listing it would
    // rerun on every render since it's redefined each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (openingFromLauncher) {
    return <p className="py-16 text-center text-sm text-muted">Opening a new piece…</p>;
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

      {/* Search + filters */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, tags, or text…"
            className="pl-9"
          />
        </div>
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="sm:w-44"
        >
          <option value="all">All types</option>
          {DOC_TYPES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.emoji} {t.label}
            </option>
          ))}
        </Select>
        {allTags.length > 0 && (
          <Select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="sm:w-44"
          >
            <option value="all">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                🏷️ {t}
              </option>
            ))}
          </Select>
        )}
      </div>

      {/* Select mode: pick several, delete them in one go. */}
      {docs.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {selecting ? (
            <>
              <span className="text-xs font-medium text-muted">
                {selected.length} selected
              </span>
              <button
                onClick={() =>
                  setSelected(
                    selected.length === filtered.length ? [] : filtered.map((d) => d.id),
                  )
                }
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-ink"
              >
                {selected.length === filtered.length ? "Clear all" : "Select all"}
              </button>
              <Button
                size="sm"
                variant="danger"
                disabled={!selected.length}
                onClick={deleteSelected}
              >
                <Trash2 size={14} /> Delete
              </Button>
              <button
                onClick={exitSelect}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted transition hover:text-ink"
              >
                <X size={13} /> Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setSelecting(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:border-[var(--accent)]/50 hover:text-ink"
            >
              <CheckSquare size={13} /> Select
            </button>
          )}
        </div>
      )}

      {loading ? (
        <p className="py-16 text-center text-sm text-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={docs.length === 0 ? "Nothing here yet" : "No matches"}
          hint={
            docs.length === 0
              ? "Start with an email you need to send — paste your rough version or describe what you need."
              : "Try a different search, type, or tag."
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
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.label}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {group.label}
                </h2>
                <span className="text-[11px] text-muted">{group.docs.length}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {group.docs.map((d) => {
                  const picked = selected.includes(d.id);
                  return (
                    <li
                      key={d.id}
                      className={`group cursor-pointer rounded-xl border bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                        picked
                          ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/20"
                          : `border-border ${TYPE_COLORS[d.doc_type]?.edge || ""}`
                      }`}
                      onClick={() =>
                        selecting
                          ? toggleSelected(d.id)
                          : router.push(`/writing-studio/${d.id}`)
                      }
                    >
                      <div className="mb-1 flex items-center gap-2">
                        {selecting &&
                          (picked ? (
                            <CheckSquare size={15} className="text-[var(--accent)]" />
                          ) : (
                            <Square size={15} className="text-muted" />
                          ))}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TYPE_COLORS[d.doc_type]?.badge || "bg-[var(--accent-soft)] text-[var(--accent)]"}`}
                        >
                          {docTypeEmoji(d.doc_type)} {docTypeLabel(d.doc_type)}
                        </span>
                        <span className="text-xs text-muted">
                          {new Date(d.updated_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        <span className="flex-1" />
                        {!selecting && (
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
                        )}
                      </div>
                      <p className="truncate text-sm font-medium">
                        {d.title || d.subject || "Untitled"}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
                        {htmlToPlain(d.content) || htmlToPlain(d.original) || "Empty"}
                      </p>
                      {d.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {d.tags.slice(0, 4).map((t) => (
                            <button
                              key={t}
                              onClick={(e) => {
                                e.stopPropagation();
                                setTagFilter(t);
                              }}
                              className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-muted transition hover:text-[var(--accent)]"
                            >
                              🏷️ {t}
                            </button>
                          ))}
                          {d.tags.length > 4 && (
                            <span className="px-1 text-[10px] text-muted">
                              +{d.tags.length - 4}
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
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
  onCreate: (t: DocType) => Promise<void>;
}) {
  const [docType, setDocType] = useState<DocType>("email");
  const [creating, setCreating] = useState(false);

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
              {t.emoji} {t.label}
            </span>
            <p className="text-[11px] leading-snug text-muted">{t.blurb}</p>
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        Next you&apos;ll get one box. Paste a draft, paste an email you need to
        answer, or just say what you want — whichever is fastest. I&apos;ll work
        out the rest.
      </p>
      <Button
        className="w-full"
        disabled={creating}
        onClick={async () => {
          setCreating(true);
          await onCreate(docType);
        }}
      >
        {creating ? "Opening…" : "Start writing"}
      </Button>
    </Modal>
  );
}
