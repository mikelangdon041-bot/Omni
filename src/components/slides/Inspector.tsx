"use client";

// Right-hand inspector: edit the selected element's content, geometry, and
// style; generate/upload images; edit chart data. Plus add-element buttons.

import { useState } from "react";
import {
  BarChart3,
  Image as ImageIcon,
  List,
  Sparkles,
  Square,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Feedback";
import { uid, type SlideElement, type SlideTheme } from "@/lib/slides/types";

export function AddElementBar({ onAdd }: { onAdd: (el: SlideElement) => void }) {
  const base = { id: "", x: 1, y: 1.5, w: 4, h: 1 };
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          onAdd({ ...base, id: uid(), type: "text", text: "New text", fontSize: 16 })
        }
      >
        <Type size={13} /> Text
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          onAdd({
            ...base,
            id: uid(),
            type: "bullets",
            bullets: ["First point", "Second point"],
            fontSize: 16,
            h: 1.5,
          })
        }
      >
        <List size={13} /> Bullets
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onAdd({ ...base, id: uid(), type: "image", src: "", w: 3, h: 2.2 })}
      >
        <ImageIcon size={13} /> Image
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          onAdd({
            ...base,
            id: uid(),
            type: "chart",
            chartType: "bar",
            labels: ["A", "B", "C"],
            series: [{ name: "Series 1", values: [4, 7, 5] }],
            w: 4.5,
            h: 2.8,
          })
        }
      >
        <BarChart3 size={13} /> Chart
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          onAdd({ ...base, id: uid(), type: "shape", shape: "rect", w: 2, h: 1 })
        }
      >
        <Square size={13} /> Shape
      </Button>
    </div>
  );
}

export function Inspector({
  el,
  theme,
  onChange,
  onDelete,
}: {
  el: SlideElement;
  theme: SlideTheme;
  onChange: (partial: Partial<SlideElement>) => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const [imgPrompt, setImgPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  async function generateImage() {
    setGenerating(true);
    try {
      const res = await fetch("/api/slides/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "image", prompt: imgPrompt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Image generation failed");
      onChange({ src: json.url });
      setImgPrompt("");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function uploadImage(file: File | null) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast("error", "Keep uploaded images under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange({ src: String(reader.result) });
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {el.type} element
        </p>
        <button className="rounded p-1 text-muted hover:text-red-600" onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      </div>

      {/* Geometry */}
      <div className="grid grid-cols-4 gap-1.5">
        {(["x", "y", "w", "h"] as const).map((k) => (
          <label key={k} className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase text-muted">{k}</span>
            <input
              type="number"
              step={0.1}
              value={el[k]}
              onChange={(e) => onChange({ [k]: Number(e.target.value) || 0 })}
              className="w-full rounded border border-border bg-surface px-1.5 py-1 text-xs"
            />
          </label>
        ))}
      </div>

      {el.type === "text" && (
        <>
          <Textarea
            label="Text"
            value={el.text || ""}
            onChange={(e) => onChange({ text: e.target.value })}
            className="min-h-20"
          />
          <TextStyleControls el={el} onChange={onChange} />
        </>
      )}

      {el.type === "bullets" && (
        <>
          <Textarea
            label="Bullets (one per line)"
            value={(el.bullets || []).join("\n")}
            onChange={(e) => onChange({ bullets: e.target.value.split("\n") })}
            className="min-h-24"
          />
          <TextStyleControls el={el} onChange={onChange} />
        </>
      )}

      {el.type === "image" && (
        <div className="space-y-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-ink">
            <Upload size={13} /> Upload image
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                uploadImage(e.target.files?.[0] || null);
                e.target.value = "";
              }}
            />
          </label>
          <Textarea
            label="…or describe it and I'll create it"
            value={imgPrompt}
            onChange={(e) => setImgPrompt(e.target.value)}
            placeholder='e.g. "clean isometric illustration of a hospital team reviewing data, purple accent"'
            className="min-h-16"
          />
          <Button size="sm" disabled={!imgPrompt.trim() || generating} onClick={generateImage}>
            <Sparkles size={13} /> {generating ? "Creating…" : "Generate image"}
          </Button>
        </div>
      )}

      {el.type === "chart" && (
        <div className="space-y-2">
          <Select
            label="Chart type"
            value={el.chartType || "bar"}
            onChange={(e) => onChange({ chartType: e.target.value as "bar" | "line" | "pie" })}
          >
            <option value="bar">Bar</option>
            <option value="line">Line</option>
            <option value="pie">Pie</option>
          </Select>
          <Input
            label="Labels (comma-separated)"
            value={(el.labels || []).join(", ")}
            onChange={(e) =>
              onChange({ labels: e.target.value.split(",").map((s) => s.trim()) })
            }
          />
          {(el.series || []).map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-end gap-1.5">
              <Input
                label={i === 0 ? "Series" : undefined}
                value={s.name}
                onChange={(e) => {
                  const series = [...(el.series || [])];
                  series[i] = { ...series[i], name: e.target.value };
                  onChange({ series });
                }}
              />
              <Input
                label={i === 0 ? "Values (comma-sep)" : undefined}
                value={s.values.join(", ")}
                onChange={(e) => {
                  const series = [...(el.series || [])];
                  series[i] = {
                    ...series[i],
                    values: e.target.value
                      .split(",")
                      .map((v) => Number(v.trim()))
                      .filter((v) => !Number.isNaN(v)),
                  };
                  onChange({ series });
                }}
              />
              <button
                className="mb-2 rounded p-1 text-muted hover:text-red-600"
                onClick={() =>
                  onChange({ series: (el.series || []).filter((_, j) => j !== i) })
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              onChange({
                series: [
                  ...(el.series || []),
                  { name: `Series ${(el.series || []).length + 1}`, values: [1, 2, 3] },
                ],
              })
            }
          >
            Add series
          </Button>
        </div>
      )}

      {el.type === "shape" && (
        <div className="space-y-2">
          <Select
            label="Shape"
            value={el.shape || "rect"}
            onChange={(e) => onChange({ shape: e.target.value as "rect" | "ellipse" | "line" })}
          >
            <option value="rect">Rectangle</option>
            <option value="ellipse">Ellipse</option>
            <option value="line">Line</option>
          </Select>
          <ColorInput
            label="Fill"
            value={el.fill || theme.primary}
            onChange={(fill) => onChange({ fill })}
          />
        </div>
      )}
    </div>
  );
}

function TextStyleControls({
  el,
  onChange,
}: {
  el: SlideElement;
  onChange: (p: Partial<SlideElement>) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <Input
          label="Font size (pt)"
          type="number"
          value={el.fontSize || 16}
          onChange={(e) => onChange({ fontSize: Number(e.target.value) || 16 })}
        />
        <Select
          label="Align"
          value={el.align || "left"}
          onChange={(e) => onChange({ align: e.target.value as "left" | "center" | "right" })}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </Select>
      </div>
      <div className="flex items-end gap-2">
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={!!el.bold}
            onChange={(e) => onChange({ bold: e.target.checked })}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Bold
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={!!el.italic}
            onChange={(e) => onChange({ italic: e.target.checked })}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Italic
        </label>
        <span className="flex-1" />
        <ColorInput label="Color" value={el.color || ""} onChange={(color) => onChange({ color })} />
      </div>
    </div>
  );
}

export function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string; // hex without '#'
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input
        type="color"
        value={`#${(value || "888888").replace(/[^0-9A-Fa-f]/g, "").padEnd(6, "0").slice(0, 6)}`}
        onChange={(e) => onChange(e.target.value.slice(1).toUpperCase())}
        className="h-7 w-9 cursor-pointer rounded border border-border bg-surface"
      />
    </label>
  );
}
