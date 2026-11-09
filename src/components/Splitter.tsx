// Draggable divider between panels. Sizes are kept per user in localStorage.
import { useCallback, useState } from "react";

export interface PanelSizes { left: number; right: number; timeline: number; layouts: number }
const KEY = "omnicanvas.panels.v1";
export const DEFAULT_SIZES: PanelSizes = { left: 260, right: 270, timeline: 230, layouts: 260 };
const LIMITS: Record<keyof PanelSizes, [number, number]> = { left: [160, 560], right: [200, 560], timeline: [120, 700], layouts: [120, 700] };

function load(): PanelSizes {
  try { return { ...DEFAULT_SIZES, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEFAULT_SIZES; }
}

export function usePanelSizes() {
  const [sizes, setSizes] = useState<PanelSizes>(load);
  const set = useCallback((k: keyof PanelSizes, v: number) => {
    setSizes(s => {
      const next = { ...s, [k]: Math.round(Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v))) };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* keep in memory only */ }
      return next;
    });
  }, []);
  return [sizes, set] as const;
}

/**
 * axis "x" resizes a column (drag left and right), "y" resizes a row.
 * sign: +1 when dragging right or down makes the panel bigger, -1 when it makes it smaller.
 */
export function Splitter({ axis, value, sign, onChange, onReset, area, label }:
  { axis: "x" | "y"; value: number; sign: 1 | -1; onChange: (v: number) => void; onReset: () => void; area?: string; label: string }) {
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement, start = axis === "x" ? e.clientX : e.clientY, v0 = value;
    el.setPointerCapture(e.pointerId);
    document.body.classList.add(axis === "x" ? "resizing-x" : "resizing-y");
    const mv = (ev: PointerEvent) => onChange(v0 + sign * ((axis === "x" ? ev.clientX : ev.clientY) - start));
    const up = () => {
      el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      document.body.classList.remove("resizing-x", "resizing-y");
    };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    const grow = axis === "x" ? (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0) : (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0);
    if (grow) { e.preventDefault(); e.stopPropagation(); onChange(value + sign * grow * step); }
  };
  return (
    <div className={`splitter ${axis}`} style={area ? { gridArea: area } : undefined} role="separator" tabIndex={0}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"} aria-label={label} title="Drag to resize. Double-click to reset."
      onPointerDown={onDown} onDoubleClick={onReset} onKeyDown={onKey} />
  );
}
