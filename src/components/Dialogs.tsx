import { useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { S, currentLayout, useStore } from "../store";
import { exportLayout, type ExportResult } from "../engine/ffmpeg";
import { resizeProgram, fitToScreen } from "../model/defaults";
import type { Layer } from "../model/types";
import { even, projectDuration, sourceLabel, sourceSize, tc } from "../util";
import { resetLayer, updateLayer } from "./LayoutCanvas";

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="modal" onPointerDown={e => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** OBS "Edit Transform" (Ctrl+E). */
export function TransformDialog() {
  const project = useStore(s => s.project);
  const layerId = useStore(s => s.layerId);
  const sc = currentLayout();
  const l = sc.layers.find(x => x.id === layerId);
  const close = () => S().set({ dialog: null });
  if (!l) return <Modal title="Edit Transform" onClose={close}><p>Select a source first.</p><div className="actions"><button className="btn" onClick={close}>Close</button></div></Modal>;
  const set = (patch: Partial<Layer>) => updateLayer(sc.id, l.id, patch);
  const num = (label: string, value: number, apply: (v: number) => void) => (
    <label className="field"><span>{label}</span>
      <input type="number" value={Math.round(value)} onChange={e => { const v = +e.target.value; if (Number.isFinite(v)) apply(v); }} /></label>
  );
  return (
    <Modal title={`Edit Transform: ${l.name}`} onClose={close}>
      <div className="grid2">
        {num("Position X", l.x, v => set({ x: v }))}
        {num("Position Y", l.y, v => set({ y: v }))}
        {num("Width", l.w, v => set({ w: Math.max(1, v) }))}
        {num("Height", l.h, v => set({ h: Math.max(1, v) }))}
        {num("Crop left", l.crop.l, v => set({ crop: { ...l.crop, l: Math.max(0, v) } }))}
        {num("Crop right", l.crop.r, v => set({ crop: { ...l.crop, r: Math.max(0, v) } }))}
        {num("Crop top", l.crop.t, v => set({ crop: { ...l.crop, t: Math.max(0, v) } }))}
        {num("Crop bottom", l.crop.b, v => set({ crop: { ...l.crop, b: Math.max(0, v) } }))}
      </div>
      <p className="hint">Position and size are in layout pixels ({sc.width}×{sc.height}). Crop is in pixels of the source, {sourceLabel(project, l.source)} ({project.width}×{project.height}).</p>
      <div className="actions">
        <button className="btn" onClick={() => set(resetLayer(project, sc, l))}>Reset</button>
        <button className="btn" onClick={() => set(fitToScreen(project, l, sc.width, sc.height))}>Fit to screen</button>
        <button className="btn" onClick={() => set({ x: 0, y: 0, w: sc.width, h: sc.height })}>Stretch to screen</button>
        <span className="grow" />
        <button className="btn primary" onClick={close}>Close</button>
      </div>
    </Modal>
  );
}

export function SettingsDialog() {
  const p = useStore(s => s.project);
  const [w, setW] = useState(p.width), [h, setH] = useState(p.height), [fps, setFps] = useState(p.fps), [name, setName] = useState(p.name);
  const close = () => S().set({ dialog: null });
  return (
    <Modal title="Project settings" onClose={close}>
      <label className="field"><span>Name</span><input value={name} onChange={e => setName(e.target.value)} /></label>
      <div className="grid2">
        <label className="field"><span>Program width</span><input type="number" value={w} onChange={e => setW(+e.target.value)} /></label>
        <label className="field"><span>Program height</span><input type="number" value={h} onChange={e => setH(+e.target.value)} /></label>
      </div>
      <label className="field"><span>Frame rate</span>
        <select value={fps} onChange={e => setFps(+e.target.value)}>{[24, 25, 30, 50, 60].map(f => <option key={f} value={f}>{f} fps</option>)}</select></label>
      <p className="hint">The program size should match your OBS recording. Every clip is fitted into it, and crops are measured in its pixels. Changing it keeps crops on the same part of the picture.</p>
      <div className="actions"><span className="grow" />
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" onClick={() => {
          S().commit(pr => { pr.name = name.trim() || "Untitled"; pr.fps = fps; if (even(w) !== pr.width || even(h) !== pr.height) resizeProgram(pr, even(w), even(h)); });
          close();
        }}>Save</button>
      </div>
    </Modal>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";

export function ExportDialog() {
  const p = useStore(s => s.project);
  const [picked, setPicked] = useState<Record<string, boolean>>(() => Object.fromEntries(p.layouts.map(s => [s.id, true])));
  const [folder, setFolder] = useState<string | null>(null);
  const [quality, setQuality] = useState(19);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [results, setResults] = useState<ExportResult[]>([]);
  const cancelRef = useRef<null | (() => Promise<void>)>(null);
  const cancelled = useRef(false);
  const total = projectDuration(p);
  const close = () => { if (!busy) S().set({ dialog: null }); };

  const run = async () => {
    if (!folder) return;
    setBusy(true); setResults([]); cancelled.current = false;
    const snapshot = JSON.parse(JSON.stringify(S().project));
    const out: ExportResult[] = [];
    for (const sc of snapshot.layouts) {
      if (!picked[sc.id] || cancelled.current) continue;
      const path = await join(folder, `${slug(snapshot.name)}-${slug(sc.name)}.mp4`);
      const r = await exportLayout(snapshot, sc, path, quality, f => setProgress(x => ({ ...x, [sc.id]: f })), fn => { cancelRef.current = fn; });
      out.push(cancelled.current ? { ...r, error: "Cancelled." } : r);
      setResults([...out]);
    }
    setBusy(false);
  };

  return (
    <Modal title="Export" onClose={close}>
      <p className="hint">Every layout renders from the same timeline ({tc(total, p.fps)} at {p.fps} fps). OmniCanvas uses the NVIDIA encoder when it can and the CPU encoder otherwise.</p>
      {!total && <p className="warn">The timeline is empty. Add a clip first.</p>}
      <div className="checks">
        {p.layouts.map(s => (
          <label key={s.id} className="check">
            <input type="checkbox" checked={!!picked[s.id]} disabled={busy} onChange={e => setPicked(x => ({ ...x, [s.id]: e.target.checked }))} />
            <span>{s.name} <small>{s.width}×{s.height}</small></span>
            {progress[s.id] !== undefined && <div className="bar"><i style={{ width: `${Math.round(progress[s.id] * 100)}%` }} /></div>}
          </label>
        ))}
      </div>
      <div className="field"><span>Save to</span>
        <div className="row"><code className="path">{folder ?? "No folder chosen"}</code>
          <button className="btn" disabled={busy} onClick={async () => { const f = await open({ directory: true }); if (typeof f === "string") setFolder(f); }}>Choose…</button></div></div>
      <label className="field"><span>Quality</span>
        <select value={quality} disabled={busy} onChange={e => setQuality(+e.target.value)}>
          <option value={17}>Highest, larger files</option><option value={19}>High (recommended for YouTube)</option><option value={23}>Smaller files</option>
        </select></label>
      {results.length > 0 && <ul className="results">
        {results.map(r => <li key={r.layout.id}><b>{r.layout.name}</b>{r.error ? <pre className="warn">{r.error}</pre> : <><code className="path">{r.path}</code><small>{r.encoder === "nvenc" ? "NVIDIA encoder" : "CPU encoder"}</small></>}</li>)}
      </ul>}
      <div className="actions">
        {busy && <button className="btn" onClick={() => { cancelled.current = true; void cancelRef.current?.(); }}>Cancel</button>}
        <span className="grow" />
        <button className="btn" disabled={busy} onClick={close}>Close</button>
        <button className="btn primary" disabled={busy || !folder || !total || !Object.values(picked).some(Boolean)} onClick={() => void run()}>{busy ? "Rendering…" : "Render"}</button>
      </div>
    </Modal>
  );
}
