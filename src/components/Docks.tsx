// Left: Project Media (Vegas name). Right: Layouts and Layers.
import { useState } from "react";
import { S, useStore } from "../store";
import { addClip, addLayer, importMedia, moveLayerWithinTrack, setLayerSource, targetTrack, trackAccepts } from "../actions";
import { horizontalLayout, verticalLayout, fitLayer } from "../model/defaults";
import type { Layer, Layout } from "../model/types";
import { uid } from "../util";
import { ContextMenu, layerMenuItems, updateLayer } from "./LayoutCanvas";

const fmtDur = (d: number) => { const s = Math.round(d); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function MediaBin() {
  const media = useStore(s => s.project.media);
  const clips = useStore(s => s.project.clips);
  const proxy = useStore(s => s.proxyProgress);
  const add = (id: string, kind: "video" | "audio") => { const t = targetTrack(kind); if (t) addClip(id, t.id, S().time); };
  return (
    <section className="dock">
      <header><h2>Project Media</h2><button className="btn small" onClick={() => void importMedia()}>Import…</button></header>
      <ul className="media-list">
        {media.map(m => {
          const uses = clips.filter(c => c.mediaId === m.id).length;
          const pp = proxy[m.id];
          return (
            <li key={m.id} draggable onDragStart={e => { e.dataTransfer.setData("application/x-omni-media", m.id); e.dataTransfer.effectAllowed = "copy"; }}
              onDoubleClick={() => add(m.id, m.kind === "audio" ? "audio" : "video")} title={m.path}>
              <div className={`kind ${m.kind}`}>{m.kind === "video" ? "VID" : m.kind === "audio" ? "AUD" : "IMG"}</div>
              <div className="meta">
                <b>{m.name}</b>
                <small>{m.kind !== "image" && fmtDur(m.duration)}{m.width ? ` · ${m.width}×${m.height}` : ""}{m.fps ? ` · ${m.fps} fps` : ""} · used {uses}×</small>
                {pp !== undefined && <div className="bar" title="Making a preview copy"><i style={{ width: `${Math.round(pp * 100)}%` }} /></div>}
                {m.proxyPath && pp === undefined && <small className="ok">Preview copy in use</small>}
              </div>
              <div className="row">
                {trackAccepts(m, "video") && <button className="btn tiny" title="Add to the selected video track at the cursor" onClick={() => add(m.id, "video")}>V</button>}
                {m.hasAudio && <button className="btn tiny" title="Add to the selected audio track at the cursor" onClick={() => add(m.id, "audio")}>A</button>}
              </div>
            </li>
          );
        })}
        {!media.length && <li className="empty">Import recordings, music or images. Drag them onto a track, or double-click to add them at the cursor.</li>}
      </ul>
    </section>
  );
}

export function LayoutsDock() {
  const layouts = useStore(s => s.project.layouts);
  const layoutId = useStore(s => s.layoutId);
  const pw = useStore(s => s.project.width), ph = useStore(s => s.project.height);
  const v1 = useStore(s => s.project.tracks.find(t => t.kind === "video")?.id ?? "");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const sel = layouts.find(s => s.id === layoutId) ?? layouts[0];
  const add = (lo: Layout) => { S().commit(p => { p.layouts.push(lo); }); S().set({ layoutId: lo.id, layerId: null, mode: "layout" }); setAdding(false); };
  const src = { type: "track" as const, trackId: v1 };
  return (
    <section className="dock">
      <header><h2>Layouts</h2>
        <div className="row">
          <button className="btn tiny" title="Add layout" onClick={() => setAdding(a => !a)}>+</button>
          <button className="btn tiny" title="Duplicate layout" onClick={() => add({ ...JSON.parse(JSON.stringify(sel)), id: uid(), name: sel.name + " copy" })}>⧉</button>
          <button className="btn tiny" title="Remove layout" disabled={layouts.length < 2}
            onClick={() => { S().commit(p => { p.layouts = p.layouts.filter(s => s.id !== sel.id); }); S().set({ layoutId: S().project.layouts[0].id, layerId: null }); }}>−</button>
        </div>
      </header>
      {adding && <div className="add-menu">
        <button onClick={() => add(horizontalLayout(pw, ph, v1))}>Horizontal 16:9</button>
        <button onClick={() => add(verticalLayout(pw, ph, v1))}>Vertical 9:16, two layers</button>
        <button onClick={() => add({ id: uid(), name: "Vertical, one layer", width: 1080, height: 1920, background: "#000000", layers: [fitLayer("Gameplay", src, pw, ph, 1080, 1920)] })}>Vertical 9:16, one layer</button>
        <button onClick={() => add({ id: uid(), name: "Square", width: 1080, height: 1080, background: "#000000", layers: [fitLayer("Gameplay", src, pw, ph, 1080, 1080)] })}>Square 1:1</button>
      </div>}
      <ul className="list">
        {layouts.map(s => (
          <li key={s.id} className={s.id === sel.id ? "sel" : ""} onClick={() => S().set({ layoutId: s.id, layerId: null, mode: "layout" })}
            onDoubleClick={() => setEditing(s.id)}>
            {editing === s.id
              ? <input autoFocus defaultValue={s.name} onBlur={e => { const v = e.target.value.trim(); if (v) S().commit(p => { p.layouts.find(x => x.id === s.id)!.name = v; }); setEditing(null); }}
                  onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }} />
              : <><span>{s.name}</span><small>{s.width}×{s.height}</small></>}
          </li>
        ))}
      </ul>
      <div className="scene-props">
        <label>W <input type="number" min={16} step={2} value={sel.width} onChange={e => { const v = Math.max(16, +e.target.value || 16); S().commit(p => { p.layouts.find(x => x.id === sel.id)!.width = v; }); }} /></label>
        <label>H <input type="number" min={16} step={2} value={sel.height} onChange={e => { const v = Math.max(16, +e.target.value || 16); S().commit(p => { p.layouts.find(x => x.id === sel.id)!.height = v; }); }} /></label>
        <label title="Background colour">BG <input type="color" value={sel.background} onChange={e => { const v = e.target.value; S().commit(p => { p.layouts.find(x => x.id === sel.id)!.background = v; }); }} /></label>
      </div>
    </section>
  );
}

/**
 * The layers of the current layout, grouped by video track in timeline order:
 * the top group is the top track, which draws in front in every layout.
 * Within a group, the top layer is in front.
 */
export function LayersDock() {
  const project = useStore(s => s.project);
  const layoutId = useStore(s => s.layoutId);
  const layerId = useStore(s => s.layerId);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const lo = project.layouts.find(s => s.id === layoutId) ?? project.layouts[0];
  const sel = lo.layers.find(l => l.id === layerId);
  const vtracks = project.tracks.filter(t => t.kind === "video");
  const groups = vtracks.map(t => ({ track: t, layers: lo.layers.filter(l => l.source.trackId === t.id).reverse() })).filter(g => g.layers.length);
  const same = sel ? lo.layers.filter(l => l.source.trackId === sel.source.trackId) : [];
  const pos = sel ? same.findIndex(l => l.id === sel.id) : -1;

  const row = (l: Layer) => (
    <li key={l.id} className={l.id === layerId ? "sel" : ""} onClick={() => S().set({ layerId: l.id, clipId: null, mode: "layout" })}
      onDoubleClick={() => setEditing(l.id)}
      onContextMenu={e => { e.preventDefault(); S().set({ layerId: l.id, clipId: null }); setMenu({ x: e.clientX, y: e.clientY, id: l.id }); }}>
      {editing === l.id
        ? <input autoFocus defaultValue={l.name} onBlur={e => { const v = e.target.value.trim(); if (v) updateLayer(lo.id, l.id, { name: v }); setEditing(null); }}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }} />
        : <span className={`layer-name${l.visible ? "" : " dim"}`}>{l.name}</span>}
      <span className="row">
        <button className={`icon${l.visible ? " on" : ""}`} title={l.visible ? "Hide in this layout" : "Show in this layout"} onClick={e => { e.stopPropagation(); updateLayer(lo.id, l.id, { visible: !l.visible }); }}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />{l.visible ? <circle cx="8" cy="8" r="2" fill="currentColor" /> : <path d="M2.5 13.5l11-11" />}</svg></button>
        <button className={`icon${l.locked ? " on" : ""}`} title={l.locked ? "Unlock" : "Lock"} onClick={e => { e.stopPropagation(); updateLayer(lo.id, l.id, { locked: !l.locked }); }}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3.5" y="7" width="9" height="7" rx="1" />{l.locked ? <path d="M5.5 7V5a2.5 2.5 0 015 0v2" /> : <path d="M5.5 7V5a2.5 2.5 0 014.8-1" />}</svg></button>
      </span>
    </li>
  );

  return (
    <section className="dock">
      <header><h2>Layers</h2>
        <div className="row">
          <button className="btn tiny" title="Add layer" onClick={() => setAdding(a => !a)}>+</button>
          <button className="btn tiny" title="Bring forward within its track" disabled={!sel || pos >= same.length - 1} onClick={() => sel && moveLayerWithinTrack(lo.id, sel.id, 1)}>↑</button>
          <button className="btn tiny" title="Send backward within its track" disabled={!sel || pos <= 0} onClick={() => sel && moveLayerWithinTrack(lo.id, sel.id, -1)}>↓</button>
          <button className="btn tiny" title="Edit Transform (Ctrl+E)" disabled={!sel} onClick={() => S().set({ dialog: "transform" })}>⤢</button>
        </div>
      </header>
      {adding && <div className="add-menu" onClick={() => setAdding(false)}>
        <span className="menu-h">Show a video track in this layout</span>
        {vtracks.map(t => <button key={t.id} onClick={() => addLayer({ type: "track", trackId: t.id })}>{t.name}</button>)}
        <button onClick={() => addLayer({ type: "newTrack" })}>New video track</button>
      </div>}
      <ul className="list">
        {groups.map(g => [
          <li key={`g${g.track.id}`} className="group">{g.track.name}</li>,
          ...g.layers.map(row),
        ])}
        {!groups.length && <li className="empty">No layers yet. Place a clip on a video track and its layers appear here, or press + to add one.</li>}
      </ul>
      {sel && <label className="shows">Shows
        <select value={sel.source.trackId} onChange={e => setLayerSource(lo.id, sel.id, { type: "track", trackId: e.target.value })}>
          {vtracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>}
      <p className="hint">Higher tracks in the timeline draw in front. Drag to move, drag a red handle to resize, Alt-drag a handle to crop.</p>
      {menu && (() => { const l = lo.layers.find(x => x.id === menu.id); return l ? <ContextMenu x={menu.x} y={menu.y} items={layerMenuItems(lo, l)} onClose={() => setMenu(null)} /> : null; })()}
    </section>
  );
}
