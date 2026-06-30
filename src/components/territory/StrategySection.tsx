"use client";

import { useState } from "react";
import { Plus, Trash2, Check, ArrowRight, Pencil } from "lucide-react";
import { useQuarterlyGoals } from "@/lib/territory/hooks";
import type { KOL } from "@/lib/territory/types";
import { cn } from "@/lib/territory/utils";
import { Button } from "@/components/ui/Button";
import { RichText, RichTextView } from "@/components/ui/RichText";

const FIELDS: { key: keyof KOL; label: string }[] = [
  { key: "areas_of_interest", label: "Areas of interest" },
  { key: "potential_collaborations", label: "Potential collaborations" },
  { key: "primary_objective", label: "Primary objective" },
  { key: "backup_questions", label: "Backup questions" },
  { key: "other_info", label: "Other info" },
];

const NOW = new Date();
const CUR_YEAR = NOW.getFullYear();
const CUR_Q = Math.floor(NOW.getMonth() / 3) + 1;

export function StrategySection({
  kol,
  update,
}: {
  kol: KOL;
  update: (p: Partial<KOL>) => Promise<void>;
}) {
  const { goals, add, update: updateGoal, remove, carryForward } =
    useQuarterlyGoals(kol.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<KOL>>({});
  const [newGoal, setNewGoal] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveFields() {
    setSaving(true);
    await update(draft);
    setSaving(false);
    setEditing(false);
    setDraft({});
  }

  async function addGoal() {
    const text = newGoal.trim();
    if (!text) return;
    await add({ year: CUR_YEAR, quarter: CUR_Q, goal: text });
    setNewGoal("");
  }

  return (
    <div className="space-y-5">
      {/* Engagement strategy fields */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Engagement strategy
          </h3>
          {editing ? (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => { setEditing(false); setDraft({}); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveFields} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={14} /> Edit
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => {
            const value = (draft[f.key] ?? kol[f.key] ?? "") as string;
            if (editing) {
              return (
                <div key={f.key}>
                  <p className="mb-1 text-xs font-medium text-muted">{f.label}</p>
                  <RichText
                    value={value}
                    onChange={(html) => setDraft((d) => ({ ...d, [f.key]: html }))}
                  />
                </div>
              );
            }
            if (!value) return null;
            return (
              <div key={f.key}>
                <p className="text-xs text-muted">{f.label}</p>
                <RichTextView html={value} />
              </div>
            );
          })}
        </div>
        {!editing && FIELDS.every((f) => !((kol[f.key] ?? "") as string)) && (
          <p className="text-sm text-muted">No strategy notes yet.</p>
        )}
      </div>

      {/* Quarterly goals */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Quarterly goals
        </h3>
        <div className="mb-4 flex gap-2">
          <input
            value={newGoal}
            onChange={(e) => setNewGoal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addGoal()}
            placeholder={`Add a goal for Q${CUR_Q} ${CUR_YEAR}…`}
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
          />
          <Button size="sm" onClick={addGoal}>
            <Plus size={14} /> Add
          </Button>
        </div>

        {goals.length === 0 ? (
          <p className="text-sm text-muted">No goals yet.</p>
        ) : (
          <ul className="space-y-2">
            {goals.map((g) => (
              <li
                key={g.id}
                className="flex items-start gap-2.5 rounded-lg border border-border p-3"
              >
                <button
                  onClick={() => updateGoal(g.id, { discussed: !g.discussed })}
                  className={cn(
                    "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border transition",
                    g.discussed
                      ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                      : "border-border",
                  )}
                  title={g.discussed ? "Discussed" : "Mark discussed"}
                >
                  {g.discussed && <Check size={13} />}
                </button>
                <div className="flex-1">
                  <p className={cn("text-sm", g.discussed && "text-muted line-through")}>
                    {g.goal}
                  </p>
                  <p className="text-xs text-muted">
                    Q{g.quarter} {g.year}
                    {g.carried_from_quarter &&
                      ` · carried from Q${g.carried_from_quarter} ${g.carried_from_year}`}
                  </p>
                </div>
                <button
                  onClick={() =>
                    carryForward(
                      g,
                      g.quarter === 4 ? g.year + 1 : g.year,
                      g.quarter === 4 ? 1 : g.quarter + 1,
                    )
                  }
                  title="Carry forward to next quarter"
                  className="text-muted transition hover:text-[var(--accent)]"
                >
                  <ArrowRight size={15} />
                </button>
                <button
                  onClick={() => remove(g.id)}
                  title="Delete"
                  className="text-muted transition hover:text-status-error"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
