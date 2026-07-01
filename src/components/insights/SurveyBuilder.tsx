"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  CornerDownRight,
  CheckCircle2,
  FileEdit,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useSurveyAdmin, useOrgProfile } from "@/lib/insights/hooks";
import { buildTree } from "@/lib/insights/survey";
import { cn } from "@/lib/ui";
import {
  QuestionEditorModal,
  type QuestionSubmit,
} from "./QuestionEditorModal";
import { ImportSurveyModal } from "./ImportSurveyModal";
import type {
  ImportDraftQuestion,
  QuestionNode,
  QuestionType,
} from "@/lib/insights/types";

const TYPE_BADGE: Record<QuestionType, string> = {
  single: "Single",
  multi: "Multi",
  boolean: "Yes/No",
  scale: "Scale",
  number: "Number",
  text: "Text",
};

// Where a new/edited question should sit in the tree.
interface EditorCtx {
  existing?: QuestionNode | null;
  parentQuestionId?: string | null;
  parentOptionId?: string | null;
  branchLabel?: string;
}

export function SurveyBuilder() {
  const { orgId, isAdmin, loading: profileLoading } = useOrgProfile();
  const admin = useSurveyAdmin(orgId);
  const {
    template,
    questions,
    options,
    loading,
    createTemplate,
    updateTemplate,
    addQuestion,
    updateQuestion,
    removeQuestion,
    addOption,
    updateOption,
    removeOption,
    bulkImport,
    setAllChoiceType,
  } = admin;

  const [editor, setEditor] = useState<EditorCtx | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [busy, setBusy] = useState(false);

  const tree = useMemo(
    () => buildTree(questions, options),
    [questions, options],
  );

  // Import a reviewed document draft — create the template first if needed.
  async function handleImport(drafts: ImportDraftQuestion[]) {
    let t = template;
    if (!t) t = await createTemplate({ name: "KOL Insights Survey" });
    if (!t) throw new Error("Could not create the survey");
    return bulkImport(t.id, drafts);
  }

  if (profileLoading || loading) {
    return <p className="py-12 text-center text-sm text-muted">Loading…</p>;
  }

  if (!isAdmin) {
    return (
      <EmptyState
        title="Survey editing is admin-only"
        hint="Your organization's admins define the canonical survey so every MSL's answers stay comparable. You can still answer surveys and explore analytics."
      />
    );
  }

  if (!template) {
    return (
      <>
        <EmptyState
          title="No survey yet"
          hint="Import an existing survey document, or start one from scratch. Every MSL will answer the same questions per KOL."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setShowImport(true)}>
                <Upload size={16} /> Import from document
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await createTemplate({ name: "KOL Insights Survey" });
                  setBusy(false);
                }}
              >
                <Plus size={16} /> Start from scratch
              </Button>
            </div>
          }
        />
        <ImportSurveyModal
          open={showImport}
          onClose={() => setShowImport(false)}
          onImport={handleImport}
        />
      </>
    );
  }

  // Persist a question draft coming back from the modal (add or edit + reconcile
  // its options), placing it at the right spot in the branch tree.
  async function persistQuestion(data: QuestionSubmit, ctx: EditorCtx) {
    setBusy(true);
    try {
      const base = {
        text: data.text,
        help_text: data.help_text,
        type: data.type,
        required: data.required,
        scale_min: data.scale_min,
        scale_max: data.scale_max,
        section: data.section,
      };

      let questionId = ctx.existing?.id;
      if (!questionId) {
        const siblings = ctx.parentQuestionId
          ? (tree
              .flatMap((n) => flatten(n))
              .find((n) => n.id === ctx.parentQuestionId)?.children.length ?? 0)
          : tree.length;
        const created = await addQuestion({
          ...base,
          parent_question_id: ctx.parentQuestionId ?? null,
          parent_option_id: ctx.parentOptionId ?? null,
          sort_order: siblings,
        });
        questionId = created?.id;
      } else {
        await updateQuestion(questionId, base);
      }
      if (!questionId) return;

      // Reconcile options.
      for (const id of data.removedOptionIds) await removeOption(id);
      for (let i = 0; i < data.options.length; i++) {
        const o = data.options[i];
        if (o.id) {
          await updateOption(o.id, { label: o.label, color: o.color, sort_order: i });
        } else {
          await addOption({
            question_id: questionId,
            label: o.label,
            color: o.color,
            sort_order: i,
          });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const published = template.status === "published";

  return (
    <div className="flex flex-col gap-5">
      {/* Template header */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="min-w-0 flex-1">
          <input
            defaultValue={template.name}
            onBlur={(e) =>
              e.target.value.trim() &&
              e.target.value !== template.name &&
              updateTemplate(template.id, { name: e.target.value.trim() })
            }
            className="w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-lg font-semibold tracking-tight outline-none hover:border-border focus:border-[var(--accent)]"
          />
          <div className="mt-1 flex items-center gap-2 px-1">
            <Badge
              className={
                published
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }
            >
              {published ? (
                <>
                  <CheckCircle2 size={12} /> Published
                </>
              ) : (
                <>
                  <FileEdit size={12} /> Draft
                </>
              )}
            </Badge>
            <span className="text-xs text-muted">v{template.version}</span>
            <span className="text-xs text-muted">
              · {questions.length} question{questions.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowImport(true)}>
            <Upload size={16} /> Import
          </Button>
          {published ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => updateTemplate(template.id, { status: "draft" })}
            >
              Unpublish
            </Button>
          ) : (
            <Button
              disabled={busy || questions.length === 0}
              onClick={() =>
                updateTemplate(template.id, { status: "published" })
              }
            >
              <CheckCircle2 size={16} /> Publish
            </Button>
          )}
        </div>
      </div>

      {/* Bulk answer-style control */}
      {questions.some((q) => q.type === "single" || q.type === "multi") && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm">
          <span className="text-muted">Set all choice questions to:</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => setAllChoiceType(template.id, "single")}
          >
            Choose one (single)
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => setAllChoiceType(template.id, "multi")}
          >
            Select all that apply (multiple)
          </Button>
          <span className="text-xs text-muted">
            (or set each question individually below)
          </span>
        </div>
      )}

      {/* Question tree */}
      {tree.length === 0 ? (
        <EmptyState
          title="No questions yet"
          hint="Add your first question. Choice questions can reveal follow-up questions based on the answer."
          action={
            <Button onClick={() => setEditor({})}>
              <Plus size={16} /> Add question
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {tree.map((node, i) => (
            <QuestionRow
              key={node.id}
              node={node}
              index={i + 1}
              depth={0}
              onEdit={(n) => setEditor({ existing: n })}
              onDelete={(id) => {
                if (confirm("Delete this question and its follow-ups?"))
                  removeQuestion(id);
              }}
              onAddFollowUp={(parent, optionId, optionLabel) =>
                setEditor({
                  parentQuestionId: parent.id,
                  parentOptionId: optionId,
                  branchLabel: `Follow-up shown when the answer is “${optionLabel}”`,
                })
              }
            />
          ))}
        </div>
      )}

      {tree.length > 0 && (
        <Button variant="secondary" className="self-start" onClick={() => setEditor({})}>
          <Plus size={16} /> Add top-level question
        </Button>
      )}

      <QuestionEditorModal
        open={!!editor}
        onClose={() => setEditor(null)}
        existing={editor?.existing ?? null}
        branchLabel={editor?.branchLabel}
        onSubmit={(data) => {
          if (editor) return persistQuestion(data, editor);
        }}
      />

      <ImportSurveyModal
        open={showImport}
        onClose={() => setShowImport(false)}
        onImport={handleImport}
      />
    </div>
  );
}

function flatten(node: QuestionNode): QuestionNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function QuestionRow({
  node,
  index,
  depth,
  onEdit,
  onDelete,
  onAddFollowUp,
}: {
  node: QuestionNode;
  index: number;
  depth: number;
  onEdit: (n: QuestionNode) => void;
  onDelete: (id: string) => void;
  onAddFollowUp: (parent: QuestionNode, optionId: string, optionLabel: string) => void;
}) {
  const canBranch = node.options.length > 0;
  return (
    <div style={{ marginLeft: depth * 20 }}>
      <div className="group rounded-xl border border-border bg-surface p-3.5 shadow-sm transition hover:border-[var(--accent)]/40">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-accent-soft text-xs font-semibold text-accent">
            {depth === 0 ? index : <CornerDownRight size={13} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-ink">{node.text || "(untitled)"}</p>
              <Badge className="bg-slate-100 text-slate-600">
                {TYPE_BADGE[node.type]}
              </Badge>
              {node.required && (
                <Badge className="bg-rose-100 text-rose-600">Required</Badge>
              )}
              {node.section && (
                <span className="text-xs text-muted">· {node.section}</span>
              )}
            </div>
            {node.help_text && (
              <p className="mt-0.5 text-xs text-muted">{node.help_text}</p>
            )}
            {node.options.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {node.options.map((o) => (
                  <span
                    key={o.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: o.color || "#cbd5e1" }}
                    />
                    {o.label}
                    <button
                      onClick={() => onAddFollowUp(node, o.id, o.label)}
                      title={`Add a follow-up for “${o.label}”`}
                      className="ml-0.5 text-muted transition hover:text-[var(--accent)]"
                    >
                      <Plus size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
            <button
              onClick={() => onEdit(node)}
              className="rounded-lg p-1.5 text-muted transition hover:bg-canvas hover:text-ink"
              aria-label="Edit"
            >
              <Pencil size={15} />
            </button>
            <button
              onClick={() => onDelete(node.id)}
              className="rounded-lg p-1.5 text-muted transition hover:bg-canvas hover:text-status-error"
              aria-label="Delete"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      </div>

      {node.children.length > 0 && (
        <div className={cn("mt-2 flex flex-col gap-2 border-l-2 border-dashed border-border pl-3")}>
          {node.children.map((child) => (
            <BranchGroup key={child.id} parent={node} child={child}>
              <QuestionRow
                node={child}
                index={0}
                depth={depth + 1}
                onEdit={onEdit}
                onDelete={onDelete}
                onAddFollowUp={onAddFollowUp}
              />
            </BranchGroup>
          ))}
        </div>
      )}
      {canBranch && node.children.length === 0 && null}
    </div>
  );
}

// Small caption showing which answer reveals a child question.
function BranchGroup({
  parent,
  child,
  children,
}: {
  parent: QuestionNode;
  child: QuestionNode;
  children: React.ReactNode;
}) {
  const opt = parent.options.find((o) => o.id === child.parent_option_id);
  return (
    <div>
      {opt && (
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
          if “{opt.label}”
        </p>
      )}
      {children}
    </div>
  );
}
