"use client";

import { useEffect, useRef, useState } from "react";
import { GripHorizontal, X } from "lucide-react";

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  movable = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
  /**
   * Lets the writer drag the dialog out of the way by its header. For the
   * ones where the thing you need to look at is the page behind them: you
   * cannot write an instruction about a question you can no longer see.
   */
  movable?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const width =
    size === "lg" ? "max-w-3xl" : size === "sm" ? "max-w-sm" : "max-w-xl";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-start sm:overflow-y-auto sm:p-8"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Panel is its own component so that it mounts fresh every time the
          dialog opens, which is what resets a dragged position. */}
      <Panel width={width} title={title} onClose={onClose} movable={movable}>
        {children}
      </Panel>
    </div>
  );
}

// Bottom sheet on phones (full-width, capped height, internal scroll);
// centered card from sm up.
function Panel({
  width,
  title,
  onClose,
  movable,
  children,
}: {
  width: string;
  title?: string;
  onClose: () => void;
  movable: boolean;
  children: React.ReactNode;
}) {
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const from = useRef({ mx: 0, my: 0, x: 0, y: 0 });

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const f = from.current;
      setOff({ x: f.x + e.clientX - f.mx, y: f.y + e.clientY - f.my });
    };
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging]);

  return (
    <div
      style={movable ? { transform: `translate(${off.x}px, ${off.y}px)` } : undefined}
      className={`flex max-h-[92dvh] w-full ${width} flex-col rounded-t-2xl border border-border bg-surface shadow-xl sm:max-h-none sm:rounded-2xl ${
        dragging ? "select-none" : ""
      }`}
    >
      <div
        onPointerDown={
          movable
            ? (e) => {
                // Never start a drag on the close button.
                if ((e.target as HTMLElement).closest("button")) return;
                from.current = { mx: e.clientX, my: e.clientY, x: off.x, y: off.y };
                setDragging(true);
              }
            : undefined
        }
        className={`flex shrink-0 items-center justify-between gap-2 border-b border-border px-5 py-4 ${
          movable ? "cursor-grab touch-none active:cursor-grabbing" : ""
        }`}
      >
        <h2 className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
          {movable && (
            <GripHorizontal size={15} className="shrink-0 text-muted/60" aria-hidden />
          )}
          <span className="truncate">{title}</span>
        </h2>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg p-1 text-muted transition hover:bg-canvas hover:text-ink"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
        {children}
      </div>
    </div>
  );
}
