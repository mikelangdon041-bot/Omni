"use client";

// Writing Studio settings: signature, diff highlighting, variant count, and
// the styles manager (rule styles + voices analyzed from writing samples).
// Everything autosaves — same pattern as the conference app.

import { useEffect, useRef, useState } from "react";
import { Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { AutoRichField } from "@/components/ui/AutoRichField";
import { useToast, useConfirm } from "@/components/ui/Feedback";
import type { WriterSettings, WriterStyle } from "@/lib/writer/types";

export function SettingsModal({
  open,
  onClose,
  settings,
  saveSettings,
  styles,
  addStyle,
  updateStyle,
  removeStyle,
}: {
  open: boolean;
  onClose: () => void;
  settings: WriterSettings | null;
  saveSettings: (p: Partial<WriterSettings>) => Promise<void>;
  styles: WriterStyle[];
  addStyle: (p: Partial<WriterStyle>) => Promise<WriterStyle | null>;
  updateStyle: (id: string, p: Partial<WriterStyle>) => Promise<void>;
  removeStyle: (id: string) => Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState<"rules" | "voice" | null>(null);
  const [name, setName] = useState("");
  const [rules, setRules] = useState("");
  const [samples, setSamples] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [editing, setEditing] = useState<WriterStyle | null>(null);

  async function analyzeAndSave() {
    if (!name.trim() || !samples.trim()) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "analyze_voice", samples }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Analysis failed");
      await addStyle({ name: name.trim(), kind: "voice", voice_profile: json.profile });
      toast("success", `Voice "${name.trim()}" saved — review it any time.`);
      setAdding(null);
      setName("");
      setSamples("");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Writing Studio settings" size="lg">
      <div className="space-y-6">
        {/* Signature — autosaves as you type */}
        <section>
          <p className="mb-2 text-xs text-muted">
            Your signature is appended to every email you copy or send from here.
          </p>
          {settings && (
            <AutoRichField
              label="Email signature"
              initialHtml={settings.signature || ""}
              canEdit
              onSave={(html) => saveSettings({ signature: html })}
              placeholder="Paste or type your signature… (saves automatically)"
              minHeight="min-h-20"
            />
          )}
        </section>

        {/* Toggles */}
        <section className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
            <span>
              <span className="block text-sm font-medium">Highlight changes</span>
              <span className="block text-xs text-muted">
                Mark what the AI changed vs. your draft
              </span>
            </span>
            <input
              type="checkbox"
              checked={settings?.show_diff ?? true}
              onChange={(e) => void saveSettings({ show_diff: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
          </label>
          <Select
            label="Variants per generation"
            value={String(settings?.variant_count ?? 1)}
            onChange={(e) => void saveSettings({ variant_count: Number(e.target.value) })}
          >
            <option value="1">1 — just the best take</option>
            <option value="2">2 variants</option>
            <option value="3">3 variants</option>
          </Select>
        </section>

        {/* Styles */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Styles & voices</h3>
              <p className="text-xs text-muted">
                Rules you write ("no em dashes, be direct") or a voice analyzed
                from your past writing. Attach them to any piece.
              </p>
            </div>
          </div>

          {styles.length > 0 && (
            <ul className="mb-3 space-y-2">
              {styles.map((s) => (
                <li key={s.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {s.kind === "voice" ? "voice" : "rules"}
                    </span>
                    <span className="flex-1" />
                    <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                    <button
                      className="rounded p-1 text-muted hover:text-red-600"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: `Delete "${s.name}"?`,
                            confirmLabel: "Delete",
                            danger: true,
                          })
                        )
                          await removeStyle(s.id);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!adding && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setAdding("rules")}>
                <Plus size={14} /> Rule style
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAdding("voice")}>
                <Wand2 size={14} /> Voice from my writing
              </Button>
            </div>
          )}

          {adding === "rules" && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <Input
                label="Style name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. "Emails to leadership"'
              />
              <Textarea
                label="Rules"
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder={"One rule per line, like you'd brief a person:\nNever use em dashes\nShort paragraphs, max 3 sentences\nSign off with just 'Best,'"}
                className="min-h-28"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!name.trim() || !rules.trim()}
                  onClick={async () => {
                    await addStyle({ name: name.trim(), kind: "rules", rules });
                    setAdding(null);
                    setName("");
                    setRules("");
                  }}
                >
                  Save style
                </Button>
              </div>
            </div>
          )}

          {adding === "voice" && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <Input
                label="Voice name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. "My email voice"'
              />
              <Textarea
                label="Paste 1–5 pieces of your writing"
                value={samples}
                onChange={(e) => setSamples(e.target.value)}
                placeholder="Paste a few real emails or docs you wrote (separate with blank lines). The AI distills how you write into a profile you can review and edit."
                className="min-h-36"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!name.trim() || !samples.trim() || analyzing}
                  onClick={analyzeAndSave}
                >
                  <Sparkles size={14} />
                  {analyzing ? "Analyzing…" : "Analyze & save voice"}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Edit one style — autosaves */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Edit "${editing.name}"` : ""}
      >
        {editing && (
          <EditStyle
            key={editing.id}
            style={editing}
            onSave={(partial) => updateStyle(editing.id, partial)}
          />
        )}
      </Modal>
    </Modal>
  );
}

function EditStyle({
  style,
  onSave,
}: {
  style: WriterStyle;
  onSave: (p: Partial<WriterStyle>) => Promise<void>;
}) {
  const [name, setName] = useState(style.name);
  const [text, setText] = useState(style.kind === "voice" ? style.voice_profile : style.rules);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const savedRef = useRef({ name: style.name, text });

  // Debounced autosave — same feel as the conference app's fields.
  useEffect(() => {
    if (name === savedRef.current.name && text === savedRef.current.text) return;
    setStatus("saving");
    const t = setTimeout(async () => {
      const finalName = name.trim() || style.name;
      await onSave(
        style.kind === "voice"
          ? { name: finalName, voice_profile: text }
          : { name: finalName, rules: text },
      );
      savedRef.current = { name, text };
      setStatus("saved");
    }, 900);
    return () => clearTimeout(t);
  }, [name, text, onSave, style.kind, style.name]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Edits save automatically
        </span>
        {status !== "idle" && (
          <span className="text-xs text-muted">
            {status === "saving" ? "Saving…" : "Saved"}
          </span>
        )}
      </div>
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <Textarea
        label={style.kind === "voice" ? "Voice profile (editable)" : "Rules"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-40"
      />
    </div>
  );
}
