"use client";

// Shared AI insight-extraction dialog (sessions, posters, contacts):
// analyze → review/check candidates → required source type → save.
// Nothing persists until the user confirms (spec §22.1/§22.3).

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/ui";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import { useCategories } from "@/lib/conference/hooks";
import { SOURCE_TYPES, type Insight } from "@/lib/conference/types";

interface Candidate {
  title: string;
  bullets: string[];
  categories: string[];
  checked: boolean;
}

export function CategoryChip({
  name,
  categories,
}: {
  name: string;
  categories: { name: string; color: string }[];
}) {
  const color = categories.find((c) => c.name === name)?.color || "#6c6982";
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
      style={{ background: color }}
    >
      {name}
    </span>
  );
}

export function GenerateInsightsModal({
  open,
  onClose,
  sourceText,
  eventId,
  contactId,
  posterId,
  insightDate,
  addWithChildren,
}: {
  open: boolean;
  onClose: () => void;
  sourceText: string;
  eventId?: string;
  contactId?: string;
  posterId?: string;
  insightDate?: string;
  addWithChildren: (
    parent: Partial<Insight>,
    children: Partial<Insight>[],
  ) => Promise<unknown>;
}) {
  const { conference } = useConferenceCtx();
  const { categories } = useCategories(conference.id);
  const [guidance, setGuidance] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [sourceType, setSourceType] = useState("");
  const [sourceOther, setSourceOther] = useState("");
  const [manualText, setManualText] = useState("");
  const [saving, setSaving] = useState(false);

  async function run() {
    if (!sourceText.trim()) {
      setError("Nothing to analyze yet — capture some notes first.");
      return;
    }
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/conference/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "extract_insights",
          text: sourceText,
          guidance,
          categories: categories.map((c) => c.name),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "AI request failed");
      setCandidates(
        (json.insights || []).map(
          (i: { title?: string; bullets?: string[]; categories?: string[] }) => ({
            title: String(i.title || "").trim(),
            bullets: Array.isArray(i.bullets) ? i.bullets.map(String) : [],
            categories: Array.isArray(i.categories) ? i.categories.map(String) : [],
            checked: true,
          }),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function confirmSave() {
    const finalSource = sourceType === "Other" ? sourceOther.trim() || "Other" : sourceType;
    if (!finalSource) return; // source type is required on confirmation
    setSaving(true);
    try {
      const selected = (candidates || []).filter((c) => c.checked && c.title);
      for (const c of selected) {
        await addWithChildren(
          {
            title: c.title,
            source_type: finalSource,
            categories: c.categories,
            event_id: eventId || null,
            contact_id: contactId || null,
            poster_id: posterId || null,
            insight_date: insightDate || null,
          },
          c.bullets.filter(Boolean).map((b) => ({ title: b })),
        );
      }
      if (manualText.trim()) {
        await addWithChildren(
          {
            title: manualText.trim(),
            source_type: finalSource,
            event_id: eventId || null,
            contact_id: contactId || null,
            poster_id: posterId || null,
            insight_date: insightDate || null,
          },
          [],
        );
      }
      reset();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setCandidates(null);
    setGuidance("");
    setManualText("");
    setSourceType("");
    setSourceOther("");
    setError("");
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Generate insights"
      size="lg"
    >
      {!candidates ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            AI scans the captured notes and proposes discrete insights for your
            review — nothing is saved until you confirm.
          </p>
          <Textarea
            label="Guidance (optional)"
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            placeholder='e.g. "Focus on treatment-sequencing opinions; ignore booth logistics"'
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={run} disabled={running}>
              <Sparkles size={15} /> {running ? "Analyzing…" : "Analyze notes"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {candidates.length === 0 ? (
            <p className="text-sm text-muted">
              No clear insights found. Try adding guidance and re-running.
            </p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {candidates.map((c, i) => (
                <label
                  key={i}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition",
                    c.checked
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]/40"
                      : "border-border",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={c.checked}
                    onChange={(e) =>
                      setCandidates((prev) =>
                        (prev || []).map((x, j) =>
                          j === i ? { ...x, checked: e.target.checked } : x,
                        ),
                      )
                    }
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{c.title}</span>
                    {c.bullets.length > 0 && (
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted">
                        {c.bullets.map((b, j) => (
                          <li key={j}>{b}</li>
                        ))}
                      </ul>
                    )}
                    {c.categories.length > 0 && (
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {c.categories.map((cat) => (
                          <CategoryChip key={cat} name={cat} categories={categories} />
                        ))}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          <Input
            label="Add a manual insight (optional)"
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="Type an extra insight to save alongside…"
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Source type * (who said it)"
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
            >
              <option value="">Choose…</option>
              {SOURCE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            {sourceType === "Other" && (
              <Input
                label="Source (free text)"
                value={sourceOther}
                onChange={(e) => setSourceOther(e.target.value)}
              />
            )}
          </div>

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setCandidates(null)}>
              ← Re-run with guidance
            </Button>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  reset();
                  onClose();
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmSave}
                disabled={
                  saving ||
                  !sourceType ||
                  ((candidates || []).every((c) => !c.checked) && !manualText.trim())
                }
              >
                {saving ? "Saving…" : "Save insights"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
