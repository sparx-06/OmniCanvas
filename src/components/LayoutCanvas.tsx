// The layout canvas. Interactions copy OBS: click a layer to select it, drag
// to move, drag a handle to resize (corners keep the aspect ratio unless Shift
// is held), Alt-drag a handle to crop, double-click for Edit Transform.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { S, currentLayout, useStore } from "../store";
import { drawLayout, player } from "../engine/player";
import type { Layer, Layout, Project } from "../model/types";
import { clamp, orderedLayers, sourceSize } from "../util";
import { fitLayer, fitToScreen } from "../model/defaults";
import { deleteSelection, moveLayerWithinTrack } from "../actions";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSOR: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
const HS = 7; // handle size, css px

function handlePos(l: Layer, h: Handle, k: number) {
  const x = h.includes("w") ? l.x : h.includes("e") ? l.x + l.w : l.x + l.w / 2;
  const y = h.includes("n") ? l.y : h.includes("s") ? l.y + l.h : l.y + l.h / 2;
  return { x: x * k, y: y * k };
}

export function updateLayer(layoutId: string, layerId: string, patch: Partial<Layer>, live = false) {
  const fn = (p: Project) => {
    const l = p.layouts.find(s => s.id === layoutId)?.layers.find(x => x.id === layerId);
    if (l) Object.assign(l, patch);
  };
  live ? S().live(fn) : S().commit(fn);
}

export function resetLayer(p: Project, lo: Layout, l: Layer): Partial<Layer> {
  const ss = sourceSize(p);
  const f = fitLayer(l.name, l.source, ss.w, ss.h, lo.width, lo.height);
  return { x: f.x, y: f.y, w: f.w, h: f.h, crop: f.crop };
}

export function layerMenuItems(lo: Layout, l: Layer): [string, () => void][] {
  const p = S().project;
  const same = lo.layers.filter(x => x.source.trackId === l.source.trackId);
  const idx = same.findIndex(x => x.id === l.id);
  const items: [string, () => void][] = [
    ["Edit Transform…", () => S().set({ dialog: "transform", layerId: l.id })],
    ["Reset Transform", () => updateLayer(lo.id, l.id, resetLayer(p, lo, l))],
    ["Fit to Screen", () => updateLayer(lo.id, l.id, fitToScreen(p, l, lo.width, lo.height))],
    ["Stretch to Screen", () => updateLayer(lo.id, l.id, { x: 0, y: 0, w: lo.width, h: lo.height })],
    ["Center to Screen", () => updateLayer(lo.id, l.id, { x: Math.round((lo.width - l.w) / 2), y: Math.round((lo.height - l.h) / 2) })],
  ];
  // Front and back between tracks come from the timeline; within one track the layout decides.
  if (idx < same.length - 1) items.push(["Bring Forward (same track)", () => moveLayerWithinTrack(lo.id, l.id, 1)]);
  if (idx > 0) items.push(["Send Backward (same track)", () => moveLayerWithinTrack(lo.id, l.id, -1)]);
  items.push([l.locked ? "Unlock" : "Lock", () => updateLayer(lo.id, l.id, { locked: !l.locked })]);
  items.push(["Remove", () => { S().set({ layerId: l.id, clipId: null }); deleteSelection(); }]);
  return items;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: [string, () => void][]; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); };
  }, [onClose]);
  return (
    <div className="ctx" style={{ left: x, top: y }} onPointerDown={e => e.stopPropagation()}>
      {items.map(([label, fn]) => <button key={label} onClick={() => { onClose(); fn(); }}>{label}</button>)}
    </div>
  );
}

export function LayoutCanvas() {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; layer: Layer } | null>(null);
  const project = useStore(s => s.project);
  const layoutId = useStore(s => s.layoutId);
  const layerId = useStore(s => s.layerId);
  const layout = project.layouts.find(s => s.id === layoutId) ?? project.layouts[0];
  const drag = useRef<null | { kind: "move" | "resize" | "crop"; handle?: Handle; o: Layer; x0: number; y0: number; layoutId: string }>(null);

  // Fit the canvas inside the panel, keeping the layout's aspect ratio.
  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect(), lo = currentLayout();
      if (!lo) return;
      const k = Math.min((r.width - 24) / lo.width, (r.height - 24) / lo.height);
      setBox({ w: Math.max(10, Math.floor(lo.width * k)), h: Math.max(10, Math.floor(lo.height * k)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout?.width, layout?.height, layoutId]);

  const redraw = () => {
    const c = cv.current, lo = currentLayout(); if (!c || !lo || !box.w) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(box.w * dpr)) { c.width = Math.round(box.w * dpr); c.height = Math.round(box.h * dpr); }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const k = c.width / lo.width;
    drawLayout(ctx, lo, k);
    // Selection, drawn like OBS: red box, red handles, cropped edges in green.
    const sel = lo.layers.find(l => l.id === S().layerId);
    if (sel && sel.visible) {
      ctx.save();
      ctx.lineWidth = Math.max(1, dpr);
      const edges: [Handle, boolean][] = [["n", sel.crop.t > 0], ["s", sel.crop.b > 0], ["w", sel.crop.l > 0], ["e", sel.crop.r > 0]];
      const x0 = sel.x * k, y0 = sel.y * k, x1 = (sel.x + sel.w) * k, y1 = (sel.y + sel.h) * k;
      for (const [e, cropped] of edges) {
        ctx.strokeStyle = cropped ? "#3ddc84" : "#ff3b30";
        ctx.beginPath();
        if (e === "n") { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); }
        if (e === "s") { ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); }
        if (e === "w") { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); }
        if (e === "e") { ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); }
        ctx.stroke();
      }
      if (!sel.locked) {
        ctx.fillStyle = "#ff3b30";
        const s = HS * dpr;
        for (const h of HANDLES) { const p = handlePos(sel, h, k); ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s); }
      }
      ctx.restore();
    }
  };

  useEffect(() => player.addView(redraw), [box.w, box.h]);
  useEffect(() => { player.draw(); }, [project, layerId, layoutId, box.w]);

  const toLayout = (e: { clientX: number; clientY: number }) => {
    const r = cv.current!.getBoundingClientRect(), lo = currentLayout();
    return { x: (e.clientX - r.left) * lo.width / r.width, y: (e.clientY - r.top) * lo.height / r.height, k: r.width / lo.width };
  };
  const hitHandle = (l: Layer, e: { clientX: number; clientY: number }): Handle | null => {
    const r = cv.current!.getBoundingClientRect(), k = r.width / currentLayout().width;
    for (const h of HANDLES) {
      const p = handlePos(l, h, k);
      if (Math.abs(e.clientX - r.left - p.x) <= HS + 2 && Math.abs(e.clientY - r.top - p.y) <= HS + 2) return h;
    }
    return null;
  };
  const hitLayer = (pt: { x: number; y: number }) => {
    const order = orderedLayers(S().project, currentLayout());
    for (let i = order.length - 1; i >= 0; i--) {
      const l = order[i];
      if (l.visible && pt.x >= l.x && pt.x <= l.x + l.w && pt.y >= l.y && pt.y <= l.y + l.h) return l;
    }
    return null;
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const lo = currentLayout(), pt = toLayout(e);
    const sel = lo.layers.find(l => l.id === S().layerId);
    let h: Handle | null = null;
    if (sel && sel.visible && !sel.locked) h = hitHandle(sel, e);
    const target = h ? sel! : hitLayer(pt);
    S().set({ layerId: target?.id ?? null, clipId: null });
    if (!target || target.locked) return;
    drag.current = { kind: h ? (e.altKey ? "crop" : "resize") : "move", handle: h ?? undefined, o: JSON.parse(JSON.stringify(target)), x0: pt.x, y0: pt.y, layoutId: lo.id };
    S().begin();
    cv.current!.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current, c = cv.current!;
    if (!d) {
      const lo = currentLayout(), sel = lo.layers.find(l => l.id === S().layerId);
      const h = sel && !sel.locked && sel.visible ? hitHandle(sel, e) : null;
      c.style.cursor = h ? CURSOR[h] : hitLayer(toLayout(e)) ? "move" : "default";
      return;
    }
    const pt = toLayout(e), dx = pt.x - d.x0, dy = pt.y - d.y0, o = d.o;
    const lo = currentLayout(), p = S().project;
    let patch: Partial<Layer> = {};
    if (d.kind === "move") {
      let nx = o.x + dx, ny = o.y + dy;
      // Snap edges and centre to the canvas edges and centre, as OBS does.
      const tol = 10 / pt.k;
      const snap = (v: number, size: number, max: number) => {
        for (const [off, target] of [[0, 0], [size, max], [size / 2, max / 2], [0, max / 2], [size, max / 2]] as [number, number][])
          if (Math.abs(v + off - target) < tol) return target - off;
        return v;
      };
      if (!e.ctrlKey) { nx = snap(nx, o.w, lo.width); ny = snap(ny, o.h, lo.height); }
      patch = { x: Math.round(nx), y: Math.round(ny) };
    } else if (d.kind === "resize") {
      const h = d.handle!;
      let x = o.x, y = o.y, w = o.w, hh = o.h;
      if (h.includes("w")) { x = o.x + dx; w = o.w - dx; }
      if (h.includes("e")) { w = o.w + dx; }
      if (h.includes("n")) { y = o.y + dy; hh = o.h - dy; }
      if (h.includes("s")) { hh = o.h + dy; }
      if (h.length === 2 && !e.shiftKey) {
        const kx = w / o.w, ky = hh / o.h;
        const kk = Math.abs(kx - 1) > Math.abs(ky - 1) ? kx : ky;
        w = o.w * kk; hh = o.h * kk;
        if (h.includes("w")) x = o.x + o.w - w;
        if (h.includes("n")) y = o.y + o.h - hh;
      }
      if (w < 4) { if (h.includes("w")) x = o.x + o.w - 4; w = 4; }
      if (hh < 4) { if (h.includes("n")) y = o.y + o.h - 4; hh = 4; }
      patch = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) };
    } else {
      // Crop keeps the picture's scale: the box shrinks with the crop.
      const h = d.handle!, ss = sourceSize(p);
      const cw = ss.w - o.crop.l - o.crop.r, ch = ss.h - o.crop.t - o.crop.b;
      const sx = cw / o.w, sy = ch / o.h;
      const crop = { ...o.crop };
      let { x, y, w } = o; let hh = o.h;
      if (h.includes("w")) { const dd = clamp(dx, -o.crop.l / sx, o.w - 4); crop.l = o.crop.l + dd * sx; x = o.x + dd; w = o.w - dd; }
      if (h.includes("e")) { const dd = clamp(dx, -(o.w - 4), o.crop.r / sx); crop.r = o.crop.r - dd * sx; w = o.w + dd; }
      if (h.includes("n")) { const dd = clamp(dy, -o.crop.t / sy, o.h - 4); crop.t = o.crop.t + dd * sy; y = o.y + dd; hh = o.h - dd; }
      if (h.includes("s")) { const dd = clamp(dy, -(o.h - 4), o.crop.b / sy); crop.b = o.crop.b - dd * sy; hh = o.h + dd; }
      patch = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh),
        crop: { l: Math.round(crop.l), t: Math.round(crop.t), r: Math.round(crop.r), b: Math.round(crop.b) } };
    }
    updateLayer(d.layoutId, o.id, patch, true);
  };

  const onUp = () => { if (drag.current) { drag.current = null; S().end(); } };

  return (
    <div className="scene-wrap" ref={wrap}>
      <canvas ref={cv} style={{ width: box.w, height: box.h }} tabIndex={0} aria-label={`${layout?.name} layout`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onDoubleClick={e => { const l = hitLayer(toLayout(e)); if (l) S().set({ layerId: l.id, dialog: "transform" }); }}
        onContextMenu={e => {
          e.preventDefault();
          const l = hitLayer(toLayout(e)); if (!l) return;
          S().set({ layerId: l.id, clipId: null });
          setMenu({ x: e.clientX, y: e.clientY, layer: l });
        }} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={layerMenuItems(layout, menu.layer)} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** All layouts side by side, read-only, like the OBS multiview. Click one to edit it. */
export function Multiview() {
  const layouts = useStore(s => s.project.layouts);
  return (
    <div className="multiview">
      {layouts.map(lo => <MultiTile key={lo.id} layout={lo} />)}
    </div>
  );
}

function MultiTile({ layout }: { layout: Layout }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(200);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => { const r = wrap.current!.getBoundingClientRect(); setH(Math.max(60, r.height - 28)); });
    ro.observe(wrap.current!.parentElement!);
    return () => ro.disconnect();
  }, []);
  const w = Math.round(h * layout.width / layout.height);
  useEffect(() => player.addView(() => {
    const c = cv.current; if (!c) return;
    const lo = S().project.layouts.find(x => x.id === layout.id); if (!lo) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    drawLayout(c.getContext("2d")!, lo, c.width / lo.width);
  }), [layout.id, w, h]);
  useEffect(() => { player.draw(); }, [layout]);
  return (
    <div className="tile" ref={wrap} onClick={() => S().set({ layoutId: layout.id, mode: "layout", layerId: null })}>
      <canvas ref={cv} style={{ width: w, height: h }} />
      <span>{layout.name} <small>{layout.width}×{layout.height}</small></span>
    </div>
  );
}
