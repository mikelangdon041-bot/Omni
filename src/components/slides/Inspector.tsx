"use client";

// Right-hand inspector: edit the selected element's content, geometry, and
// style; generate/upload images; open the chart data editor; full shape
// gallery with fill/border/label. Plus the add-element toolbar.

import { useState } from "react";
import {
  BarChart3,
  Image as ImageIcon,
  List,
  Shapes,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Feedback";
import { SHAPE_POINTS } from "./SlideCanvas";
import { uid, type ShapeKind, type SlideElement, type SlideTheme } from "@/lib/slides/types";

export const SHAPE_LIBRARY: { kind: ShapeKind; label: string }[] = [
  { kind: "rect", label: "Rectangle" },
  { kind: "roundRect", label: "Rounded" },
  { kind: "ellipse", label: "Ellipse" },
  { kind: "triangle", label: "Triangle" },
  { kind: "diamond", label: "Diamond" },
  { kind: "rightArrow", label: "Arrow →" },
  { kind: "leftArrow", label: "Arrow ←" },
  { kind: "upArrow", label: "Arrow ↑" },
  { kind: "downArrow", label: "Arrow ↓" },
  { kind: "chevron", label: "Chevron" },
  { kind: "pentagon", label: "Pentagon" },
  { kind: "star", label: "Star" },
  { kind: "line", label: "Line" },
];

export function ShapeIcon({ kind, color = "currentColor", size = 22 }: { kind: ShapeKind; color?: string; size?: number }) {
  if (kind === "line")
    return (
      <svg width={size} height={size} viewBox="0 0 100 100">
        <line x1={6} y1={80} x2={94} y2={20} stroke={color} strokeWidth={10} strokeLinecap="round" />
      </svg>
    );
  if (kind === "rect" || kind === "roundRect")
    return (
      <svg width={size} height={size} viewBox="0 0 100 100">
        <rect x={8} y={22} width={84} height={56} rx={kind === "roundRect" ? 14 : 0} fill={color} />
      </svg>
    );
  if (kind === "ellipse")
    return (
      <svg width={size} height={size} viewBox="0 0 100 100">
        <ellipse cx={50} cy={50} rx={44} ry={32} fill={color} />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <polygon points={SHAPE_POINTS[kind] || SHAPE_POINTS.pentagon} fill={color} />
    </svg>
  );
}

export function ShapeGallery({
  onPick,
  active,
}: {
  onPick: (kind: ShapeKind) => void;
  active?: ShapeKind;
}) {
  return (
    <div className="grid grid-cols-5 gap-1">
      {SHAPE_LIBRARY.map((s) => (
        <button
          key={s.kind}
          title={s.label}
          onClick={() => onPick(s.kind)}
          className={`grid aspect-square place-items-center rounded-lg border transition ${
            active === s.kind
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-border text-muted hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
          }`}
        >
          <ShapeIcon kind={s.kind} />
        </button>
      ))}
    </div>
  );
}

export function AddElementBar({
  onAdd,
  onInsertChart,
}: {
  onAdd: (el: SlideElement) => void;
  onInsertChart: () => void;
}) {
  const [showShapes, setShowShapes] = useState(false);
  const base = { id: "", x: 1, y: 1.5, w: 4, h: 1 };
  return (
    <div className="relative flex flex-wrap gap-1.5">
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
      <Button size="sm" variant="secondary" onClick={onInsertChart}>
        <BarChart3 size={13} /> Chart
      </Button>
      <Button
        size="sm"
        variant={showShapes ? "primary" : "secondary"}
        onClick={() => setShowShapes((v) => !v)}
      >
        <Shapes size={13} /> Shape
      </Button>
      {showShapes && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-border bg-surface p-2 shadow-lg">
          <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Pick a shape
          </p>
          <ShapeGallery
            onPick={(kind) => {
              onAdd({
                ...base,
                id: uid(),
                type: "shape",
                shape: kind,
                w: kind === "line" ? 3 : 2,
                h: kind === "line" ? 0.15 : kind === "rect" || kind === "roundRect" ? 1.2 : 1.6,
              });
              setShowShapes(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

export function Inspector({
  el,
  theme,
  onChange,
  onDelete,
  onEditChart,
}: {
  el: SlideElement;
  theme: SlideTheme;
  onChange: (partial: Partial<SlideElement>) => void;
  onDelete: () => void;
  onEditChart: () => void;
}) {
  const toast = useToast();
  const [imgPrompt, setImgPrompt] = useState(el.prompt || "");
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
          {el.src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={el.src} alt="" className="max-h-28 w-full rounded-lg object-cover" />
          )}
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
            <Sparkles size={13} /> {generating ? "Creating… (~15s)" : "Generate image"}
          </Button>
        </div>
      )}

      {el.type === "chart" && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            {(el.series || []).length} series · {(el.labels || []).length} categories ·{" "}
            {el.chartType || "bar"}
          </p>
          <Button size="sm" onClick={onEditChart}>
            <BarChart3 size={13} /> Edit data & type
          </Button>
        </div>
      )}

      {el.type === "shape" && (
        <div className="space-y-2.5">
          <div>
            <p className="mb-1 text-xs font-medium text-ink">Shape</p>
            <ShapeGallery active={el.shape || "rect"} onPick={(shape) => onChange({ shape })} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ColorInput
              label="Fill"
              value={el.fill || theme.primary}
              onChange={(fill) => onChange({ fill })}
            />
            <ColorInput
              label="Border"
              value={el.lineColor || ""}
              onChange={(lineColor) => onChange({ lineColor })}
            />
            <label className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-muted">Width</span>
              <input
                type="number"
                min={0}
                max={12}
                step={0.5}
                value={el.lineWidth ?? (el.shape === "line" ? 2 : 0)}
                onChange={(e) => onChange({ lineWidth: Number(e.target.value) || 0 })}
                className="w-14 rounded border border-border bg-surface px-1.5 py-1 text-xs"
              />
            </label>
          </div>
          {el.shape !== "line" && (
            <>
              <Input
                label="Label (optional)"
                value={el.text || ""}
                onChange={(e) => onChange({ text: e.target.value })}
                placeholder="Text inside the shape"
              />
              {(el.text || "").trim() && (
                <div className="flex items-end gap-2">
                  <Input
                    label="Font size"
                    type="number"
                    value={el.fontSize || 14}
                    onChange={(e) => onChange({ fontSize: Number(e.target.value) || 14 })}
                    className="!w-20"
                  />
                  <ColorInput
                    label="Text color"
                    value={el.color || "FFFFFF"}
                    onChange={(color) => onChange({ color })}
                  />
                </div>
              )}
            </>
          )}
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
