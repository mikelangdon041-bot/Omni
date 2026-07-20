"use client";

import { useRef, useState } from "react";
import { Sparkles, Loader2, Check, RotateCcw, Building2, Users, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getDataset } from "@/lib/dashboard/catalog";
import { getModule } from "@/lib/modules";
import type { ChartResult, ChartSpec, DatasetDef, Scope } from "@/lib/dashboard/types";
import { ChartCanvas } from "./ChartCanvas";

const EXAMPLE_PROMPTS = [
  "KOL tiers from Territory Planning",
  "Conference key contacts by tier",
  "My prepped meetings by type",
];

const SCOPE_ORDER: Scope[] = ["self", "team", "org"];
const SCOPE_META: Record<Scope, { icon: typeof User; label: string }> = {
  self: { icon: User, label: "Just me" },
  team: { icon: Users, label: "My team" },
  org: { icon: Building2, label: "Whole company" },
};

interface Turn {
  id: number;
  prompt: string;
  status: "loading" | "ready" | "error";
  error?: string;
  spec?: ChartSpec;
  explanation?: string;
  result?: ChartResult;
  title?: string;
  saved?: boolean;
  saving?: boolean;
}

let nextId = 1;

export function DashboardChat({
  maxScope,
  extraDatasets,
  onSaved,
}: {
  maxScope: Scope;
  extraDatasets: DatasetDef[];
  onSaved: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const availableScopes = SCOPE_ORDER.slice(0, SCOPE_ORDER.indexOf(maxScope) + 1);

  function patchTurn(id: number, patch: Partial<Turn>) {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPrompt("");
    const id = nextId++;
    setTurns((prev) => [...prev, { id, prompt: trimmed, status: "loading" }]);

    try {
      const proposeRes = await fetch("/api/dashboard/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "propose", prompt: trimmed }),
      });
      const proposeJson = await proposeRes.json();
      if (!proposeRes.ok) throw new Error(proposeJson.error || "Could not understand that request");

      const spec: ChartSpec = proposeJson.spec;
      const runRes = await fetch("/api/dashboard/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "run", spec }),
      });
      const runJson = await runRes.json();
      if (!runRes.ok) throw new Error(runJson.error || "Could not build that chart");

      patchTurn(id, {
        status: "ready",
        spec,
        explanation: proposeJson.explanation,
        result: runJson.result,
        title: spec.title,
      });
    } catch (e) {
      patchTurn(id, { status: "error", error: e instanceof Error ? e.message : "Something went wrong" });
    }
  }

  async function toggleScope(turn: Turn, scope: Scope) {
    if (!turn.spec) return;
    const spec = { ...turn.spec, scope };
    patchTurn(turn.id, { spec });
    const runRes = await fetch("/api/dashboard/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "run", spec }),
    });
    const runJson = await runRes.json();
    if (runRes.ok) patchTurn(turn.id, { result: runJson.result });
  }

  async function save(turn: Turn) {
    if (!turn.spec) return;
    patchTurn(turn.id, { saving: true });
    try {
      const res = await fetch("/api/dashboard/tiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          title: turn.title?.trim() || turn.spec.title,
          datasetId: turn.spec.datasetId,
          spec: turn.spec,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save tile");
      patchTurn(turn.id, { saved: true, saving: false });
      onSaved();
    } catch (e) {
      patchTurn(turn.id, { saving: false, error: e instanceof Error ? e.message : "Could not save" });
    }
  }

  function retry(turn: Turn) {
    setPrompt(turn.prompt + " — ");
    inputRef.current?.focus();
  }

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm">
          <Sparkles size={17} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-ink">Ask to visualize any app&apos;s data</h3>
          <p className="text-xs text-muted">
            Describe what you want to see — we&apos;ll propose a chart and preview it before saving.
          </p>
        </div>
      </div>

      {turns.length > 0 && (
        <div className="flex flex-col gap-4 px-5 py-4">
          {turns.map((turn) => (
            <div key={turn.id} className="flex flex-col gap-2">
              {/* user bubble */}
              <div className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-tr-sm bg-[var(--accent)] px-3.5 py-2 text-sm text-[var(--accent-fg)] shadow-sm">
                  {turn.prompt}
                </p>
              </div>

              {/* assistant bubble */}
              <div className="flex items-start gap-2">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-[var(--accent)]">
                  <Sparkles size={13} />
                </span>
                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-border bg-canvas px-3.5 py-3 shadow-sm">
                  {turn.status === "loading" && (
                    <p className="flex items-center gap-1.5 text-sm text-muted">
                      <Loader2 size={14} className="animate-spin" /> Thinking…
                    </p>
                  )}

                  {turn.status === "error" && (
                    <p className="text-sm text-status-error">{turn.error}</p>
                  )}

                  {turn.status === "ready" && turn.spec && turn.result && (
                    <>
                      {(() => {
                        const dataset = getDataset(turn.spec.datasetId, extraDatasets);
                        const sourceModule = dataset ? getModule(dataset.module) : undefined;
                        return dataset ? (
                          <span
                            className="mb-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={{
                              backgroundColor: sourceModule?.theme.accentSoft || "var(--accent-soft)",
                              color: sourceModule?.theme.accent || "var(--accent)",
                            }}
                          >
                            {dataset.moduleLabel} · {dataset.label}
                          </span>
                        ) : null;
                      })()}
                      <p className="text-sm text-ink">{turn.explanation}</p>

                      {availableScopes.length > 1 &&
                        getDataset(turn.spec.datasetId, extraDatasets)?.ownerScoped && (
                          <div className="mt-2.5 inline-flex rounded-lg border border-border bg-surface p-0.5 shadow-sm">
                            {availableScopes.map((s) => {
                              const meta = SCOPE_META[s];
                              return (
                                <ScopeButton
                                  key={s}
                                  active={turn.spec!.scope === s}
                                  onClick={() => toggleScope(turn, s)}
                                  icon={meta.icon}
                                  label={meta.label}
                                />
                              );
                            })}
                          </div>
                        )}

                      <div className="mt-3 rounded-xl border border-border bg-surface p-3">
                        <ChartCanvas result={turn.result} chartType={turn.spec.chartType} height={260} />
                      </div>

                      {turn.saved ? (
                        <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-status-success">
                          <Check size={15} /> Saved to your dashboard
                        </p>
                      ) : (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <input
                            value={turn.title ?? ""}
                            onChange={(e) => patchTurn(turn.id, { title: e.target.value })}
                            className="min-w-[140px] flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
                            placeholder="Tile title"
                          />
                          <Button size="sm" onClick={() => save(turn)} disabled={turn.saving}>
                            {turn.saving ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Check size={13} />
                            )}
                            Save it
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => retry(turn)}>
                            <RotateCcw size={13} /> Try again
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-border p-4">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-canvas px-3 py-2">
          <input
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(prompt)}
            placeholder="e.g. Can we visualize KOL tiers from Territory Planning?"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <Button size="sm" onClick={() => ask(prompt)} disabled={!prompt.trim()}>
            <Sparkles size={14} /> Ask
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted">Try:</span>
          {EXAMPLE_PROMPTS.map((ex) => (
            <button
              key={ex}
              onClick={() => ask(ex)}
              className="rounded-full border border-border bg-canvas px-2.5 py-1 text-[11px] text-muted transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScopeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof User;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)]"
          : "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted hover:text-ink"
      }
    >
      <Icon size={14} /> {label}
    </button>
  );
}
