"use client";

// Renders one slide scaled to a pixel width; optionally interactive
// (click-select, drag to move, corner handle to resize). Also used tiny and
// read-only for thumbnails, and large for practice mode.

import { useRef } from "react";
import {
  SLIDE_H,
  SLIDE_W,
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
          <li key={i} style={{ marginBottom: px(6) }}>
            <span style={{ color: `#${theme.primary}`, marginRight: px(6) }}>•</span>
            {b}
          </li>
        ))}
      </ul>
    );
  }

  if (el.type === "image") {
    return el.src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={el.src} alt="" className="h-full w-full object-cover" draggable={false} />
    ) : (
      <div className="grid h-full w-full place-items-center border border-dashed border-border text-xs text-muted">
        image
      </div>
    );
  }

  if (el.type === "shape") {
    if (el.shape === "line") {
      return (
        <div
          className="w-full"
          style={{
            height: Math.max(2, px(2)),
            marginTop: "auto",
            background: `#${el.fill || theme.primary}`,
          }}
        />
      );
    }
    return (
      <div
        className="h-full w-full"
        style={{
          background: `#${el.fill || theme.primary}`,
          borderRadius: el.shape === "ellipse" ? "50%" : 0,
        }}
      />
    );
  }

  if (el.type === "chart") {
    return <MiniChart el={el} theme={theme} />;
  }

  return null;
}

// Faithful-enough preview of the native pptx chart that export produces.
function MiniChart({ el, theme }: { el: SlideElement; theme: SlideTheme }) {
  const series = el.series || [];
  const labels = el.labels || [];
  const colors = [theme.primary, theme.secondary, "94A3B8", "F59E0B", "10B981"];
  const W = 200;
  const H = 112;

  if (!series.length || !series[0].values.length) {
    return (
      <div className="grid h-full w-full place-items-center border border-dashed border-border text-xs text-muted">
        chart
      </div>
    );
  }

  if (el.chartType === "pie") {
    const values = series[0].values;
    const total = values.reduce((a, b) => a + b, 0) || 1;
    let angle = -Math.PI / 2;
    const cx = 56;
    const cy = 56;
    const r = 48;
    const paths = values.map((v, i) => {
      const a0 = angle;
      angle += (v / total) * Math.PI * 2;
      const x0 = cx + r * Math.cos(a0);
      const y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const large = (angle - a0) % (Math.PI * 2) > Math.PI ? 1 : 0;
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
      </svg>
    );
  }

  const all = series.flatMap((s) => s.values);
  const max = Math.max(...all, 1);
  const n = Math.max(...series.map((s) => s.values.length), labels.length, 1);

  if (el.chartType === "line") {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
        {series.map((s, si) => (
          <polyline
            key={si}
            fill="none"
            stroke={`#${colors[si % colors.length]}`}
            strokeWidth={2}
            points={s.values
              .map(
                (v, i) =>
                  `${(i / Math.max(1, n - 1)) * (W - 12) + 6},${H - 8 - (v / max) * (H - 16)}`,
              )
              .join(" ")}
          />
        ))}
      </svg>
    );
  }

  // bar
  const groupW = (W - 12) / n;
  const barW = Math.max(3, (groupW - 4) / series.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
      {series.map((s, si) =>
        s.values.map((v, i) => (
          <rect
            key={`${si}-${i}`}
            x={6 + i * groupW + si * barW}
            y={H - 8 - (v / max) * (H - 16)}
            width={barW - 1}
            height={(v / max) * (H - 16)}
            fill={`#${colors[si % colors.length]}`}
          />
        )),
      )}
    </svg>
  );
}
