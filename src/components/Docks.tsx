// Left: Project Media (Vegas name). Right: Scenes and Sources docks (OBS names).
import { useState } from "react";
import { S, useStore } from "../store";
import { addClip, addLayer, importMedia, trackAccepts } from "../actions";
import { horizontalScene, verticalScene, fitLayer } from "../model/defaults";
import type { Scene } from "../model/types";
import { uid } from "../util";
import { ContextMenu, layerMenuItems, updateLayer } from "./ScenePreview";

const fmtDur = (d: number) => { const s = Math.round(d); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function MediaBin() {
  const media = useStore(s => s.project.media);
  const clips = useStore(s => s.project.clips);
  const proxy = useStore(s => s.proxyProgress);
  return (
    <section className="dock">
      <header><h2>Project Media</h2><button className="btn small" onClick={() => void importMedia()}>Import…</button></header>
      <ul className="media-list">
        {media.map(m => {
          const uses = clips.filter(c => c.mediaId === m.id).length;
          const pp = proxy[m.id];
          return (
            <li key={m.id} draggable onDragStart={e => { e.dataTransfer.setData("application/x-omni-media", m.id); e.dataTransfer.effectAllowed = "copy"; }}
              onDoubleClick={() => addClip(m.id, m.kind === "audio" ? "music" : "video", S().time)} title={m.path}>
              <div className={`kind ${m.kind}`}>{m.kind === "video" ? "VID" : m.kind === "audio" ? "AUD" : "IMG"}</div>
              <div className="meta">
                <b>{m.name}</b>
                <small>{m.kind !== "image" && fmtDur(m.duration)}{m.width ? ` · ${m.width}×${m.height}` : ""}{m.fps ? ` · ${m.fps} fps` : ""} · used {uses}×</small>
                {pp !== undefined && <div className="bar" title="Making a preview copy"><i style={{ width: `${Math.round(pp * 100)}%` }} /></div>}
                {m.proxyPath && pp === undefined && <small className="ok">Preview copy in use</small>}
              </div>
              <div className="row">
                {trackAccepts(m, "video") && <button className="btn tiny" title="Add to Video track at the cursor" onClick={() => addClip(m.id, "video", S().time)}>V</button>}
                {m.hasAudio && <button className="btn tiny" title="Add to Music track at the cursor" onClick={() => addClip(m.id, "music", S().time)}>M</button>}
              </div>
            </li>
          );
        })}
        {!media.length && <li className="empty">Import OBS recordings, music or images. Drag them onto the timeline, or double-click to add them at the cursor.</li>}
      </ul>
    </section>
  );
}

export function ScenesDock() {
  const scenes = useStore(s => s.project.scenes);
  const sceneId = useStore(s => s.sceneId);
  const pw = useStore(s => s.project.width), ph = useStore(s => s.project.height);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const sel = scenes.find(s => s.id === sceneId) ?? scenes[0];
  const add = (sc: Scene) => { S().commit(p => { p.scenes.push(sc); }); S().set({ sceneId: sc.id, layerId: null, mode: "scene" }); setAdding(false); };
  return (
    <section className="dock">
      <header><h2>Scenes</h2>
        <div className="row">
          <button className="btn tiny" title="Add scene" onClick={() => setAdding(a => !a)}>+</button>
          <button className="btn tiny" title="Duplicate scene" onClick={() => add({ ...JSON.parse(JSON.stringify(sel)), id: uid(), name: sel.name + " copy" })}>⧉</button>
          <button className="btn tiny" title="Remove scene" disabled={scenes.length < 2}
            onClick={() => { S().commit(p => { p.scenes = p.scenes.filter(s => s.id !== sel.id); }); S().set({ sceneId: S().project.scenes[0].id, layerId: null }); }}>−</button>
        </div>
      </header>
      {adding && <div className="add-menu">
        <button onClick={() => add(horizontalScene(pw, ph))}>Horizontal 16:9</button>
        <button onClick={() => add({ ...verticalScene(pw, ph), name: "Vertical" })}>Vertical 9:16, two sources</button>
        <button onClick={() => add({ id: uid(), name: "Vertical, one source", width: 1080, height: 1920, background: "#000000", layers: [fitLayer("Gameplay", pw, ph, 1080, 1920)] })}>Vertical 9:16, one source</button>
        <button onClick={() => add({ id: uid(), name: "Square", width: 1080, height: 1080, background: "#000000", layers: [fitLayer("Gameplay", pw, ph, 1080, 1080)] })}>Square 1:1</button>
      </div>}
      <ul className="list">
        {scenes.map(s => (
          <li key={s.id} className={s.id === sel.id ? "sel" : ""} onClick={() => S().set({ sceneId: s.id, layerId: null, mode: "scene" })}
            onDoubleClick={() => setEditing(s.id)}>
            {editing === s.id
              ? <input autoFocus defaultValue={s.name} onBlur={e => { const v = e.target.value.trim(); if (v) S().commit(p => { p.scenes.find(x => x.id === s.id)!.name = v; }); setEditing(null); }}
                  onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }} />
              : <><span>{s.name}</span><small>{s.width}×{s.height}</small></>}
          </li>
        ))}
      </ul>
      <div className="scene-props">
        <label>W <input type="number" min={16} step={2} value={sel.width} onChange={e => { const v = Math.max(16, +e.target.value || 16); S().commit(p => { p.scenes.find(x => x.id === sel.id)!.width = v; }); }} /></label>
        <label>H <input type="number" min={16} step={2} value={sel.height} onChange={e => { const v = Math.max(16, +e.target.value || 16); S().commit(p => { p.scenes.find(x => x.id === sel.id)!.height = v; }); }} /></label>
        <label title="Background colour">BG <input type="color" value={sel.background} onChange={e => { const v = e.target.value; S().commit(p => { p.scenes.find(x => x.id === sel.id)!.background = v; }); }} /></label>
      </div>
    </section>
  );
}

/** OBS calls these "Sources": the layers of the current scene, front at the top. */
export function LayersDock() {
  const scenes = useStore(s => s.project.scenes);
  const sceneId = useStore(s => s.sceneId);
  const layerId = useStore(s => s.layerId);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const sc = scenes.find(s => s.id === sceneId) ?? scenes[0];
  const sel = sc.layers.find(l => l.id === layerId);
  const move = (dir: 1 | -1) => sel && S().commit(p => {
    const s = p.scenes.find(x => x.id === sc.id)!, i = s.layers.findIndex(x => x.id === sel.id), j = i + dir;
    if (j >= 0 && j < s.layers.length) [s.layers[i], s.layers[j]] = [s.layers[j], s.layers[i]];
  });
  return (
    <section className="dock">
      <header><h2>Sources</h2>
        <div className="row">
          <button className="btn tiny" title="Add the timeline video again" onClick={addLayer}>+</button>
          <button className="btn tiny" title="Move up" disabled={!sel} onClick={() => move(1)}>↑</button>
          <button className="btn tiny" title="Move down" disabled={!sel} onClick={() => move(-1)}>↓</button>
          <button className="btn tiny" title="Edit Transform (Ctrl+E)" disabled={!sel} onClick={() => S().set({ dialog: "transform" })}>⤢</button>
        </div>
      </header>
      <ul className="list">
        {[...sc.layers].reverse().map(l => (
          <li key={l.id} className={l.id === layerId ? "sel" : ""} onClick={() => S().set({ layerId: l.id, clipId: null, mode: "scene" })}
            onDoubleClick={() => setEditing(l.id)}
            onContextMenu={e => { e.preventDefault(); S().set({ layerId: l.id, clipId: null }); setMenu({ x: e.clientX, y: e.clientY, id: l.id }); }}>
            {editing === l.id
              ? <input autoFocus defaultValue={l.name} onBlur={e => { const v = e.target.value.trim(); if (v) updateLayer(sc.id, l.id, { name: v }); setEditing(null); }}
                  onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }} />
              : <span className={l.visible ? "" : "dim"}>{l.name}</span>}
            <span className="row">
              <button className={`icon${l.visible ? " on" : ""}`} title={l.visible ? "Hide" : "Show"} onClick={e => { e.stopPropagation(); updateLayer(sc.id, l.id, { visible: !l.visible }); }}><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />{l.visible ? <circle cx="8" cy="8" r="2" fill="currentColor" /> : <path d="M2.5 13.5l11-11" />}</svg></button>
              <button className={`icon${l.locked ? " on" : ""}`} title={l.locked ? "Unlock" : "Lock"} onClick={e => { e.stopPropagation(); updateLayer(sc.id, l.id, { locked: !l.locked }); }}><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3.5" y="7" width="9" height="7" rx="1" />{l.locked ? <path d="M5.5 7V5a2.5 2.5 0 015 0v2" /> : <path d="M5.5 7V5a2.5 2.5 0 014.8-1" />}</svg></button>
            </span>
          </li>
        ))}
        {!sc.layers.length && <li className="empty">No sources. Press + to add the timeline video.</li>}
      </ul>
      <p className="hint">Drag to move. Drag a red handle to resize. Hold Alt and drag a handle to crop.</p>
      {menu && (() => { const l = sc.layers.find(x => x.id === menu.id); return l ? <ContextMenu x={menu.x} y={menu.y} items={layerMenuItems(sc, l)} onClose={() => setMenu(null)} /> : null; })()}
    </section>
  );
}
