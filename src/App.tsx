import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { S, useStore } from "./store";
import { player } from "./engine/player";
import { deleteSelection, importMedia, newDoc, openDoc, saveDoc, splitAtCursor } from "./actions";
import { MediaBin, LayoutsDock, LayersDock } from "./components/Docks";
import { LayoutCanvas, Multiview } from "./components/LayoutCanvas";
import { Timeline } from "./components/Timeline";
import { ExportDialog, SettingsDialog, TransformDialog } from "./components/Dialogs";
import { DEFAULT_SIZES, Splitter, usePanelSizes } from "./components/Splitter";
import { fileName, projectDuration, tc } from "./util";

function Transport() {
  const playing = useStore(s => s.playing);
  const time = useStore(s => s.time);
  const p = useStore(s => s.project);
  const mode = useStore(s => s.mode);
  return (
    <div className="transport">
      <button className="play" aria-label={playing ? "Pause" : "Play"} onClick={() => playing ? player.stop(false) : player.play()}>
        {playing
          ? <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" /></svg>
          : <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg>}
      </button>
      <span className="tc">{tc(time, p.fps)}</span>
      <span className="tc dim">/ {tc(projectDuration(p), p.fps)}</span>
      <span className="grow" />
      <div className="seg" role="tablist" aria-label="Preview">
        <button role="tab" aria-selected={mode === "layout"} className={mode === "layout" ? "on" : ""} onClick={() => S().set({ mode: "layout" })}>Layout</button>
        <button role="tab" aria-selected={mode === "multiview"} className={mode === "multiview" ? "on" : ""} onClick={() => S().set({ mode: "multiview" })}>Multiview</button>
      </div>
    </div>
  );
}

function MenuBar() {
  const dirty = useStore(s => s.dirty);
  const past = useStore(s => s.past.length), future = useStore(s => s.future.length);
  return (
    <header className="menubar">
      <div className="brand"><span className="mark" aria-hidden="true" />OmniCanvas</div>
      <button className="btn ghost" onClick={() => void newDoc()}>New</button>
      <button className="btn ghost" onClick={() => void openDoc()}>Open…</button>
      <button className="btn ghost" onClick={() => void saveDoc()}>Save{dirty ? " •" : ""}</button>
      <button className="btn ghost" onClick={() => void importMedia()}>Import media…</button>
      <span className="sep" />
      <button className="btn ghost" disabled={!past} onClick={() => S().undo()}>Undo</button>
      <button className="btn ghost" disabled={!future} onClick={() => S().redo()}>Redo</button>
      <span className="grow" />
      <button className="btn ghost" onClick={() => S().set({ dialog: "settings" })}>Project settings</button>
      <button className="btn primary" onClick={() => S().set({ dialog: "export" })}>Export</button>
    </header>
  );
}

export default function App() {
  const mode = useStore(s => s.mode);
  const dialog = useStore(s => s.dialog);
  const toast = useStore(s => s.toast);
  const name = useStore(s => s.project.name), path = useStore(s => s.path), dirty = useStore(s => s.dirty);
  const project = useStore(s => s.project);
  const [sizes, setSize] = usePanelSizes();

  useEffect(() => { if (!S().layoutId) S().set({ layoutId: S().project.layouts[0]?.id ?? "" }); player.seek(0); }, []);
  useEffect(() => { player.draw(); }, [project]);
  useEffect(() => {
    const title = `${dirty ? "• " : ""}${path ? fileName(path) : name} - OmniCanvas`;
    document.title = title;
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [name, path, dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (ctrl && k === "s") { e.preventDefault(); void saveDoc(e.shiftKey); return; }
      if (ctrl && k === "o") { e.preventDefault(); void openDoc(); return; }
      if (ctrl && k === "i") { e.preventDefault(); void importMedia(); return; }
      if (typing) return;
      if (S().dialog) { if (e.key === "Escape") S().set({ dialog: null }); return; }
      const fps = S().project.fps;
      if (ctrl && k === "z") { e.preventDefault(); e.shiftKey ? S().redo() : S().undo(); }
      else if (ctrl && k === "y") { e.preventDefault(); S().redo(); }
      else if (ctrl && k === "e") { e.preventDefault(); if (S().layerId) S().set({ dialog: "transform" }); }
      else if (e.key === " ") { e.preventDefault(); S().playing ? player.stop(true) : player.play(); }       // Vegas: stop and go back
      else if (e.key === "Enter") { e.preventDefault(); S().playing ? player.stop(false) : player.play(); }  // Vegas: pause in place
      else if (k === "s" && !ctrl) { e.preventDefault(); splitAtCursor(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelection(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); player.seek(S().time - (e.shiftKey ? 1 : 1 / fps)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); player.seek(S().time + (e.shiftKey ? 1 : 1 / fps)); }
      else if (e.key === "Home") { e.preventDefault(); player.seek(0); }
      else if (e.key === "End") { e.preventDefault(); player.seek(projectDuration(S().project)); }
      else if (e.key === "Escape") S().set({ clipId: null, layerId: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app" style={{ gridTemplateColumns: `${sizes.left}px 6px minmax(0, 1fr) 6px ${sizes.right}px`, gridTemplateRows: `auto minmax(0, 1fr) 6px ${sizes.timeline}px` }}>
      <MenuBar />
      <aside className="left"><MediaBin /></aside>
      <Splitter axis="x" area="sl" label="Resize the media panel" value={sizes.left} sign={1} onChange={v => setSize("left", v)} onReset={() => setSize("left", DEFAULT_SIZES.left)} />
      <main className="center">
        <div className="preview">{mode === "layout" ? <LayoutCanvas /> : <Multiview />}</div>
        <Transport />
      </main>
      <Splitter axis="x" area="sr" label="Resize the layouts and layers panel" value={sizes.right} sign={-1} onChange={v => setSize("right", v)} onReset={() => setSize("right", DEFAULT_SIZES.right)} />
      <aside className="right" style={{ gridTemplateRows: `${sizes.layouts}px 6px minmax(0, 1fr)` }}>
        <LayoutsDock />
        <Splitter axis="y" label="Resize the layouts list" value={sizes.layouts} sign={1} onChange={v => setSize("layouts", v)} onReset={() => setSize("layouts", DEFAULT_SIZES.layouts)} />
        <LayersDock />
      </aside>
      <Splitter axis="y" area="st" label="Resize the timeline" value={sizes.timeline} sign={-1} onChange={v => setSize("timeline", v)} onReset={() => setSize("timeline", DEFAULT_SIZES.timeline)} />
      <Timeline />
      {dialog === "transform" && <TransformDialog />}
      {dialog === "export" && <ExportDialog />}
      {dialog === "settings" && <SettingsDialog />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
