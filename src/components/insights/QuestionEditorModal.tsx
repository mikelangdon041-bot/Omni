"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { DEFAULT_PALETTE } from "@/lib/insights/types";
import type { QuestionNode, QuestionType } from "@/lib/insights/types";

export interface OptionDraft {
  id?: string;
  label: string;
  color: string;
}

export interface QuestionSubmit {
  text: string;
  help_text: string;
  type: QuestionType;
  required: boolean;
  scale_min: number;
  scale_max: number;
  section: string;
  options: OptionDraft[];
  removedOptionIds: string[];
}

const TYPE_LABELS: Record<QuestionType, string> = {
  single: "Single choice",
  multi: "Multiple choice",
  boolean: "Yes / No",
  scale: "Scale (slider)",
  number: "Number",
  text: "Free text",
};

const CHOICE_TYPES: QuestionType[] = ["single", "multi"];

export function QuestionEditorModal({
  open,
  onClose,
  onSubmit,
  existing,
  defaultSection = "",
  branchLabel,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: QuestionSubmit) => Promise<void> | void;
  existing?: QuestionNode | null;
  defaultSection?: string;
  branchLabel?: string; // e.g. "Follow-up shown when answer is 'Yes'"
}) {
  const [text, setText] = useState("");
  const [help, setHelp] = useState("");
  const [type, setType] = useState<QuestionType>("single");
  const [required, setRequired] = useState(false);
  const [scaleMin, setScaleMin] = useState(1);
  const [scaleMax, setScaleMax] = useState(10);
  const [section, setSection] = useState(defaultSection);
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Reset the form each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setRemoved([]);
    setSaving(false);
    if (existing) {
      setText(existing.text);
      setHelp(existing.help_text);
      setType(existing.type);
      setRequired(existing.required);
      setScaleMin(existing.scale_min ?? 1);
      setScaleMax(existing.scale_max ?? 10);
      setSection(existing.section || "");
      setOptions(
        existing.options.map((o) => ({
          id: o.id,
          label: o.label,
          color: o.color || "",
        })),
      );
    } else {
      setText("");
      setHelp("");
      setType("single");
      setRequired(false);
      setScaleMin(1);
      setScaleMax(10);
      setSection(defaultSection);
      setOptions([
        { label: "", color: DEFAULT_PALETTE[0] },
        { label: "", color: DEFAULT_PALETTE[1] },
      ]);
    }
  }, [open, existing, defaultSection]);

  const isChoice = CHOICE_TYPES.includes(type);

  function updateOption(idx: number, patch: Partial<OptionDraft>) {
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }
  function addOptionRow() {
    setOptions((prev) => [
      ...prev,
      { label: "", color: DEFAULT_PALETTE[prev.length % DEFAULT_PALETTE.length] },
    ]);
  }
  function removeOptionRow(idx: number) {
    setOptions((prev) => {
      const o = prev[idx];
      if (o.id) setRemoved((r) => [...r, o.id!]);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function handleSave() {
    if (!text.trim()) return;
    setSaving(true);
    // Boolean auto-generates Yes/No options; scale/number/text keep none.
    let opts: OptionDraft[] = [];
    let removedIds = removed;
    if (isChoice) {
      opts = options.filter((o) => o.label.trim());
    } else if (type === "boolean") {
      // Preserve existing Yes/No ids when editing so branch links survive.
      const yes = existing?.options.find((o) => /yes|true/i.test(o.label));
      const no = existing?.options.find((o) => /no|false/i.test(o.label));
      opts = [
        { id: yes?.id, label: "Yes", color: "#10b981" },
        { id: no?.id, label: "No", color: "#e11d48" },
      ];
    } else {
      // Non-choice: drop any previously-existing options.
      removedIds = [...removed, ...(existing?.options.map((o) => o.id) || [])];
    }
    await onSubmit({
      text: text.trim(),
      help_text: help.trim(),
      type,
      required,
      scale_min: scaleMin,
      scale_max: scaleMax,
      section: section.trim(),
      options: opts,
      removedOptionIds: removedIds,
    });
    setSaving(false);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? "Edit question" : "Add question"}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        {branchLabel && (
          <div className="rounded-lg bg-accent-soft px-3 py-2 text-xs font-medium text-accent">
            {branchLabel}
          </div>
        )}

        <Textarea
          label="Question"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Do you currently prescribe Drug X?"
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Answer type"
            value={type}
            onChange={(e) => setType(e.target.value as QuestionType)}
          >
            {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
          <Input
            label="Section (optional)"
            value={section}
            onChange={(e) => setSection(e.target.value)}
            placeholder="e.g. Product perception"
          />
        </div>

        {type === "scale" && (
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Scale min"
              type="number"
              value={scaleMin}
              onChange={(e) => setScaleMin(Number(e.target.value))}
            />
            <Input
              label="Scale max"
              type="number"
              value={scaleMax}
              onChange={(e) => setScaleMax(Number(e.target.value))}
            />
          </div>
        )}

        {isChoice && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">Answer options</span>
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <GripVertical size={14} className="shrink-0 text-muted" />
                <input
                  type="color"
                  value={o.color || "#f59e0b"}
                  onChange={(e) => updateOption(i, { color: e.target.value })}
                  className="h-8 w-8 shrink-0 cursor-pointer rounded border border-border bg-surface"
                  title="Option color"
                />
                <input
                  value={o.label}
                  onChange={(e) => updateOption(i, { label: e.target.value })}
                  placeholder={`Option ${i + 1}`}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                />
                <button
                  onClick={() => removeOptionRow(i)}
                  className="shrink-0 rounded-lg p-2 text-muted transition hover:bg-canvas hover:text-status-error"
                  aria-label="Remove option"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button
              onClick={addOptionRow}
              className="flex items-center gap-1.5 self-start rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-accent-soft"
            >
              <Plus size={14} /> Add option
            </button>
          </div>
        )}

        <Textarea
          label="Help text (optional)"
          value={help}
          onChange={(e) => setHelp(e.target.value)}
          placeholder="Extra guidance shown under the question."
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Required to count as complete
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !text.trim()}>
            {saving ? "Saving…" : existing ? "Save changes" : "Add question"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
