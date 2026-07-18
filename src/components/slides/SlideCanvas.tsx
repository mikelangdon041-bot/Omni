"use client";

// Renders one slide scaled to a pixel width; optionally interactive
// (click-select, drag to move, corner handle to resize). Also used tiny and
// read-only for thumbnails, and large for practice mode.

import { useRef } from "react";
import { ImageIcon } from "lucide-react";
import {
  SLIDE_H,
  SLIDE_W,
  isDarkHex,
  type ShapeKind,
  type Slide,
  type SlideElement,
  type SlideTheme,
} from "@/lib/slides/types";

export function SlideCanvas({
  slide,
  theme,
  width,
  interactive,
  selectedId,
  onSelect,
  onChange,
}: {
  slide: Slide;
  theme: SlideTheme;
  width: number;
  interactive?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onChange?: (elements: SlideElement[]) => void;
}) {
  const scale = width / SLIDE_W; // px per inch
  const height = SLIDE_H * scale;
  const dragRef = useRef<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
  } | null>(null);

  function onPointerDown(
    e: React.PointerEvent,
    el: SlideElement,
    mode: "move" | "resize",
  ) {
    if (!interactive) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onSelect?.(el.id);
    dragRef.current = {
      id: el.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: el.x, y: el.y, w: el.w, h: el.h },
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || !onChange) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    const next = slide.elements.map((el) => {
      if (el.id !== d.id) return el;
      if (d.mode === "move") {
        return {
          ...el,
          x: Math.round(clamp(d.orig.x + dx, -1, SLIDE_W - 0.2) * 100) / 100,
          y: Math.round(clamp(d.orig.y + dy, -1, SLIDE_H - 0.2) * 100) / 100,
        };
      }
      return {
        ...el,
        w: Math.round(Math.max(0.3, d.orig.w + dx) * 100) / 100,
        h: Math.round(Math.max(0.2, d.orig.h + dy) * 100) / 100,
      };
    });
    onChange(next);
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  return (
    <div
      className="relative overflow-hidden rounded-md border border-border shadow-sm"
      style={{ width, height, background: `#${slide.bg || theme.bg}` }}
      onPointerDown={() => interactive && onSelect?.(null)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {slide.elements.map((el) => (
        <div
          key={el.id}
          onPointerDown={(e) => onPointerDown(e, el, "move")}
          className={
            interactive
              ? `absolute ${selectedId === el.id ? "outline outline-2 outline-[var(--accent)]" : "hover:outline hover:outline-1 hover:outline-[var(--accent)]/40"} cursor-move`
              : "absolute"
          }
          style={{
            left: el.x * scale,
            top: el.y * scale,
            width: el.w * scale,
            height: el.h * scale,
          }}
        >
          <ElementView el={el} theme={theme} scale={scale} />
          {interactive && selectedId === el.id && (
            <div
              onPointerDown={(e) => onPointerDown(e, el, "resize")}
              className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-[var(--accent)]"
            />
          )}
        </div>
      ))}
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

// SVG outlines for the non-css shapes, in a 100×100 viewBox.
export const SHAPE_POINTS: Partial<Record<ShapeKind, string>> = {
  triangle: "50,4 96,96 4,96",
  diamond: "50,2 98,50 50,98 2,50",
  rightArrow: "2,30 62,30 62,8 98,50 62,92 62,70 2,70",
  leftArrow: "98,30 38,30 38,8 2,50 38,92 38,70 98,70",
  upArrow: "30,98 30,38 8,38 50,2 92,38 70,38 70,98",
  downArrow: "30,2 30,62 8,62 50,98 92,62 70,62 30,62 30,2 70,2 70,62",
  chevron: "2,4 72,4 98,50 72,96 2,96 28,50",
  pentagon: "50,2 98,38 79,96 21,96 2,38",
  star: "50,2 61,36 98,36 68,58 79,94 50,72 21,94 32,58 2,36 39,36",
};

function ElementView({
  el,
  theme,
  scale,
}: {
  el: SlideElement;
  theme: SlideTheme;
  scale: number;
}) {
  const px = (pt: number) => (pt * scale) / 72;

  if (el.type === "text") {
    return (
      <div
        className="h-full w-full overflow-hidden whitespace-pre-wrap"
        style={{
          fontSize: px(el.fontSize || 16),
          lineHeight: 1.3,
          fontWeight: el.bold ? 700 : 400,
          fontStyle: el.italic ? "italic" : undefined,
          textAlign: el.align || "left",
          color: `#${el.color || theme.text}`,
          background: el.fill ? `#${el.fill}` : undefined,
          fontFamily: (el.fontSize || 16) >= 20 ? theme.headFont : theme.bodyFont,
        }}
      >
        {el.text}
      </div>
    );
  }

  if (el.type === "bullets") {
    return (
      <ul
        className="h-full w-full overflow-hidden"
        style={{
          fontSize: px(el.fontSize || 16),
          lineHeight: 1.35,
          color: `#${el.color || theme.text}`,
          textAlign: el.align || "left",
          fontFamily: theme.bodyFont,
          listStyle: "none",
        }}
      >
        {(el.bullets || []).map((b, i) => (
          <li key={i} style={{ marginBottom: px(6), display: "flex" }}>
            <span
              style={{
                color: `#${el.color || theme.primary}` === `#${theme.text}` ? `#${theme.primary}` : `#${el.color || theme.primary}`,
                marginRight: px(7),
                flexShrink: 0,
              }}
            >
              •
            </span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (el.type === "image") {
    return el.src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={el.src}
        alt=""
        className="h-full w-full rounded-[2px] object-cover"
        draggable={false}
      />
    ) : (
      <div
        className="grid h-full w-full place-items-center rounded-[2px] border border-dashed"
        style={{
          borderColor: `#${theme.secondary}66`,
          background: isDarkHex(theme.bg) ? "#ffffff0d" : "#00000006",
          color: `#${theme.secondary}`,
        }}
      >
        <div className="flex flex-col items-center gap-1 p-1 text-center">
          <ImageIcon size={Math.max(12, Math.min(28, scale * 0.45))} />
          {scale > 45 && (
            <span style={{ fontSize: Math.max(8, scale * 0.14) }}>
              {el.prompt ? "Image slot — generate or upload" : "image"}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (el.type === "shape") {
    const fill = `#${el.fill || theme.primary}`;
    const stroke = el.lineColor ? `#${el.lineColor}` : undefined;
    const strokeW = el.lineWidth ? Math.max(1, px(el.lineWidth)) : 0;
    const kind = el.shape || "rect";
    const label = el.text ? (
      <span
        className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden text-center"
        style={{
          fontSize: px(el.fontSize || 14),
          fontWeight: el.bold ? 700 : 500,
          color: `#${el.color || (isDarkHex(el.fill || theme.primary) ? "FFFFFF" : "1F2937")}`,
          fontFamily: theme.bodyFont,
          lineHeight: 1.2,
          padding: "6%",
        }}
      >
        {el.text}
      </span>
    ) : null;

    if (kind === "line") {
      return (
        <div className="relative flex h-full w-full items-center">
          <div
            className="w-full"
            style={{ height: Math.max(2, px(el.lineWidth || 2)), background: fill }}
          />
        </div>
      );
    }

    if (kind === "rect" || kind === "roundRect" || kind === "ellipse") {
      return (
        <div className="relative h-full w-full">
          <div
            className="h-full w-full"
            style={{
              background: fill,
              borderRadius:
                kind === "ellipse" ? "50%" : kind === "roundRect" ? Math.max(4, scale * 0.12) : 0,
              border: strokeW ? `${strokeW}px solid ${stroke || fill}` : undefined,
            }}
          />
          {label}
        </div>
      );
    }

    const pts = SHAPE_POINTS[kind];
    return (
      <div className="relative h-full w-full">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
          <polygon
            points={pts || SHAPE_POINTS.pentagon}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeW ? (strokeW / (el.w * scale)) * 100 : 0}
          />
        </svg>
        {label}
      </div>
    );
  }

  if (el.type === "chart") {
    return <MiniChart el={el} theme={theme} scale={scale} />;
  }

  return null;
}

// Faithful-enough preview of the native pptx chart that export produces.
function MiniChart({ el, theme, scale }: { el: SlideElement; theme: SlideTheme; scale: number }) {
  const series = el.series || [];
  const labels = el.labels || [];
  const colors = [theme.primary, theme.secondary, "94A3B8", "F59E0B", "10B981", "3B82F6"];
  const W = 220;
  const H = 124;
  const showLabels = scale > 40 && labels.length > 0;

  if (!series.length || !series[0].values.length) {
    return (
      <div
        className="grid h-full w-full place-items-center rounded-[2px] border border-dashed text-xs"
        style={{ borderColor: `#${theme.secondary}66`, color: `#${theme.secondary}` }}
      >
        chart — add data
      </div>
    );
  }

  if (el.chartType === "pie" || el.chartType === "doughnut") {
    const values = series[0].values;
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const cx = 56;
    const cy = 56;
    const r = 48;
    // Cumulative start angle per slice (no mutation during render).
    const starts = values.reduce<number[]>(
      (acc, v) => [...acc, acc[acc.length - 1] + (v / total) * Math.PI * 2],
      [-Math.PI / 2],
    );
    const paths = values.map((v, i) => {
      const a0 = starts[i];
      const a1 = starts[i + 1];
      const x0 = cx + r * Math.cos(a0);
      const y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1);
      const y1 = cy + r * Math.sin(a1);
      const large = (a1 - a0) % (Math.PI * 2) > Math.PI ? 1 : 0;
      return (
        <path
          key={i}
          d={`M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`}
          fill={`#${colors[i % colors.length]}`}
        />
      );
    });
    return (
      <svg viewBox="0 0 112 112" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        {paths}
        {el.chartType === "doughnut" && <circle cx={cx} cy={cy} r={r * 0.55} fill={`#${theme.bg}`} />}
      </svg>
    );
  }

  const all = series.flatMap((s) => s.values);
  const max = Math.max(...all, 1);
  const n = Math.max(...series.map((s) => s.values.length), labels.length, 1);
  const axis = `#${theme.text}40`;
  const bottom = showLabels ? H - 14 : H - 6;

  const frame = (
    <>
      <line x1={8} y1={4} x2={8} y2={bottom} stroke={axis} strokeWidth={1} />
      <line x1={8} y1={bottom} x2={W - 4} y2={bottom} stroke={axis} strokeWidth={1} />
    </>
  );

  const xFor = (i: number) => 12 + (i / Math.max(1, n - 1)) * (W - 22);
  const yFor = (v: number) => bottom - 2 - (v / max) * (bottom - 10);

  const labelRow = showLabels ? (
    <>
      {labels.slice(0, n).map((l, i) => (
        <text
          key={i}
          x={el.chartType === "line" || el.chartType === "area" ? xFor(i) : 10 + ((i + 0.5) * (W - 22)) / n}
          y={H - 3}
          fontSize={7}
          textAnchor="middle"
          fill={`#${theme.text}99`}
        >
          {l.slice(0, 8)}
        </text>
      ))}
    </>
  ) : null;

  if (el.chartType === "line" || el.chartType === "area") {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
        {frame}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ");
          return (
            <g key={si}>
              {el.chartType === "area" && (
                <polygon
                  points={`12,${bottom - 2} ${pts} ${xFor(s.values.length - 1)},${bottom - 2}`}
                  fill={`#${colors[si % colors.length]}33`}
                />
              )}
              <polyline
                fill="none"
                stroke={`#${colors[si % colors.length]}`}
                strokeWidth={2}
                points={pts}
              />
            </g>
          );
        })}
        {labelRow}
      </svg>
    );
  }

  // bar
  const groupW = (W - 22) / n;
  const barW = Math.max(3, (groupW - 4) / series.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
      {frame}
      {series.map((s, si) =>
        s.values.map((v, i) => (
          <rect
            key={`${si}-${i}`}
            x={10 + i * groupW + si * barW}
            y={yFor(v)}
            width={barW - 1}
            height={bottom - 2 - yFor(v)}
            rx={1}
            fill={`#${colors[si % colors.length]}`}
          />
        )),
      )}
      {labelRow}
    </svg>
  );
}
