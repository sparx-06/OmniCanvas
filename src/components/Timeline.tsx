// The timeline follows Vegas: a click anywhere moves the cursor (playhead) there,
// including a click on a clip. Drag a clip to move it (also onto another track
// of the same kind), drag its edge to trim it. Mouse wheel zooms around the
// pointer; Shift+wheel scrolls sideways.
import { useEffect, useRef, useState } from "react";
import { S, useStore } from "../store";
import { player } from "../engine/player";
import { addClip, addTrack, deleteSelection, deleteTrack, moveTrack, splitAtCursor, trackAccepts } from "../actions";
import { layersForNewTrack } from "../model/defaults";
import { insertClip, insertPoint } from "../model/edit";
import type { Clip, Track } from "../model/types";
import { clamp, clipEnd, projectDuration, snapFrame, tc } from "../util";

const RULER = 26, HEAD = 128, EDGE = 7;
const rowH = (t: Track) => t.kind === "video" ? 62 : 44;

export function Timeline() {
  const project = useStore(s => s.project);
  const pps = useStore(s => s.pps);
  const clipId = useStore(s => s.clipId);
  const trackId = useStore(s => s.trackId);
  const scroller = useRef<HTMLDivElement>(null);
  const lanes = useRef<HTMLDivElement>(null);
  const [insertAt, setInsertAt] = useState<{ track: string; t: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [trackDrag, setTrackDrag] = useState<{ id: string; over: string; after: boolean } | null>(null);

  // Drag a track header up or down to reorder tracks of the same kind.
  // For video tracks this changes what draws in front in every layout.
  const onHeadDown = (e: React.PointerEvent, t: Track) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input")) return;
    const el = e.currentTarget as HTMLElement, y0 = e.clientY;
    let dragging = false, target: { over: string; after: boolean } | null = null;
    el.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientY - y0) < 5) return;
      dragging = true;
      const head = document.elementsFromPoint(ev.clientX, ev.clientY).find(n => (n as HTMLElement).dataset?.head) as HTMLElement | undefined;
      const over = head && S().project.tracks.find(x => x.id === head.dataset.head);
      if (over && over.kind === t.kind) {
        const r = head!.getBoundingClientRect();
        target = { over: over.id, after: ev.clientY > r.top + r.height / 2 };
        setTrackDrag({ id: t.id, ...target });
      }
    };
    const up = () => {
      el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      setTrackDrag(null);
      if (!dragging || !target || target.over === t.id) return;
      const same = S().project.tracks.filter(x => x.kind === t.kind && x.id !== t.id);
      const i = same.findIndex(x => x.id === target!.over);
      moveTrack(t.id, i + (target.after ? 1 : 0));
    };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };
  const total = projectDuration(project);
  const width = Math.max((total + 30) * pps, 600);
  const media = new Map(project.media.map(m => [m.id, m]));
  const sel = project.clips.find(c => c.id === clipId);

  // Time under a screen x, measured from the start of the lanes (scroll included).
  const timeAt = (clientX: number) => Math.max(0, (clientX - lanes.current!.getBoundingClientRect().left) / S().pps);

  // Click or drag on empty space or the ruler: move the cursor, clear the clip selection.
  const onBgDown = (e: React.PointerEvent, tr?: Track) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    S().set({ clipId: null, ...(tr ? { trackId: tr.id } : {}) });
    player.seek(snapFrame(timeAt(e.clientX), S().project.fps));
    const mv = (ev: PointerEvent) => player.seek(snapFrame(timeAt(ev.clientX), S().project.fps));
    const up = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up);
  };

  const onClipDown = (e: React.PointerEvent, c: Clip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const mode = e.clientX - r.left < EDGE ? "l" : r.right - e.clientX < EDGE ? "r" : "move";
    const fps = S().project.fps, x0 = e.clientX, y0 = e.clientY, o = { ...c };
    const m = S().project.media.find(x => x.id === c.mediaId)!;
    S().set({ clipId: c.id, layerId: null, trackId: c.track });
    if (mode === "move") player.seek(snapFrame(timeAt(e.clientX), fps));  // Vegas: clicking a clip moves the cursor too
    let started = false;
    el.setPointerCapture(e.pointerId);

    const others = () => S().project.clips.filter(x => x.id !== c.id);
    const snapT = (t: number) => {
      const tol = 8 / S().pps;
      let best = t, dist = tol;
      for (const s of [0, S().time, ...others().flatMap(x => [x.start, clipEnd(x)])]) if (Math.abs(s - t) < dist) { best = s; dist = Math.abs(s - t); }
      return best;
    };
    const overlaps = (track: string, start: number, end: number) =>
      others().some(x => x.track === track && start < clipEnd(x) - 1e-6 && end > x.start + 1e-6);
    // Track under the pointer, if this clip may go there.
    const trackUnder = (ev: PointerEvent) => {
      const lane = document.elementsFromPoint(ev.clientX, ev.clientY).find(n => (n as HTMLElement).dataset?.track) as HTMLElement | undefined;
      const tr = lane && S().project.tracks.find(t => t.id === lane.dataset.track);
      return tr && trackAccepts(m, tr.kind) && S().project.tracks.find(t => t.id === o.track)?.kind === tr.kind ? tr.id : undefined;
    };

    const mv = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / S().pps;
      if (!started) { if (Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return; started = true; if (S().playing) player.stop(false); S().begin(); }
      const len = o.out - o.in;
      let patch: Partial<Clip> = {};
      if (mode === "move") {
        let start = snapFrame(Math.max(0, o.start + dt), fps);
        const a = snapT(start), b = snapT(start + len) - len;
        start = Math.max(0, Math.abs(a - start) <= Math.abs(b - start) ? a : b);
        const track = trackUnder(ev) ?? S().project.clips.find(x => x.id === c.id)!.track;
        patch = { start, track };
        // Dropping onto other clips inserts there; show where.
        setInsertAt(overlaps(track, start, start + len)
          ? { track, t: insertPoint(others().filter(x => x.track === track).sort((a, b) => a.start - b.start), timeAt(ev.clientX)) }
          : null);
      } else if (mode === "l") {
        const prevEnd = Math.max(0, ...others().filter(x => x.track === c.track && clipEnd(x) <= o.start + 1e-6).map(clipEnd));
        let start = snapT(snapFrame(o.start + dt, fps));
        const minIn = m.kind === "image" ? -1e9 : 0;
        start = clamp(start, Math.max(prevEnd, o.start - (o.in - minIn)), clipEnd(o) - 1 / fps);
        patch = { start, in: o.in + (start - o.start) };
        player.seek(start);
      } else {
        const nextStart = Math.min(1e9, ...others().filter(x => x.track === c.track && x.start >= clipEnd(o) - 1e-6).map(x => x.start));
        let end = snapT(snapFrame(clipEnd(o) + dt, fps));
        const maxOut = m.kind === "image" ? 1e9 : m.duration;
        end = clamp(end, o.start + 1 / fps, Math.min(nextStart, o.start + (maxOut - o.in)));
        patch = { out: o.in + (end - o.start) };
        player.seek(end - 1 / fps);
      }
      S().live(p => { Object.assign(p.clips.find(x => x.id === c.id)!, patch); });
      player.draw();
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      if (!started) return;
      const cur = S().project.clips.find(x => x.id === c.id)!;
      if (mode === "move" && overlaps(cur.track, cur.start, clipEnd(cur))) {
        // Insert at the drop point and push the other clips along (Premiere's insert drag).
        const tp = ev.type === "pointercancel" ? o.start : timeAt(ev.clientX);
        S().live(p => {
          Object.assign(p.clips.find(x => x.id === c.id)!, { start: o.start, track: o.track });
          insertClip(p, c.id, { start: o.start, track: o.track }, tp, cur.track);
        });
      }
      const moved = S().project.clips.find(x => x.id === c.id)!;
      if (moved.track !== o.track) {
        // Moving a clip onto a video track nobody shows yet gives layouts a layer for it.
        const tr = S().project.tracks.find(t => t.id === cur.track);
        if (tr?.kind === "video") S().live(p => layersForNewTrack(p, tr.id, tr.name));
      }
      setInsertAt(null);
      S().end();
      player.seek(S().time);
    };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };

  const onWheel = (e: React.WheelEvent) => {
    const sc = scroller.current!;
    if (e.shiftKey) { sc.scrollLeft += e.deltaY || e.deltaX; return; }
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const t = timeAt(e.clientX), r = sc.getBoundingClientRect();
    const next = clamp(S().pps * Math.exp(-e.deltaY * 0.0015), 2, 600);
    S().set({ pps: next });
    requestAnimationFrame(() => { sc.scrollLeft = t * next - (e.clientX - r.left - HEAD); });
  };

  const onDrop = (e: React.DragEvent, tr: Track) => {
    const id = e.dataTransfer.getData("application/x-omni-media");
    if (!id) return;
    e.preventDefault();
    addClip(id, tr.id, snapFrame(timeAt(e.clientX), S().project.fps));
  };

  // Keep the cursor in view during playback.
  useEffect(() => useStore.subscribe((s, prev) => {
    if (!s.playing || s.time === prev.time || !scroller.current) return;
    const sc = scroller.current, x = s.time * s.pps;
    if (x > sc.scrollLeft + sc.clientWidth - HEAD - 40) sc.scrollLeft = x - 80;
  }), []);

  const fit = () => { const w = scroller.current!.clientWidth - HEAD - 40; S().set({ pps: clamp(w / Math.max(total, 1), 2, 600) }); scroller.current!.scrollLeft = 0; };
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(s => s * pps >= 90) ?? 900;
  const ticks: number[] = [];
  for (let s = 0; s <= (width + 3000) / pps; s += step) ticks.push(s);
  const tracksH = project.tracks.reduce((h, t) => h + rowH(t), 0);

  return (
    <section className="timeline">
      <div className="tl-bar">
        <h2>Timeline</h2>
        <button className="btn small" onClick={splitAtCursor} title="Split at cursor (S)">Split</button>
        <button className="btn small" onClick={deleteSelection} disabled={!sel} title="Delete (Delete key)">Delete</button>
        {sel && <label className="vol">Volume
          <input type="range" min={0} max={2} step={0.05} value={sel.volume ?? 1}
            onPointerDown={() => S().begin()} onPointerUp={() => S().end()}
            onChange={e => { const v = +e.target.value; S().live(p => { p.clips.find(x => x.id === sel.id)!.volume = v; }); }} />
          <output>{Math.round((sel.volume ?? 1) * 100)}%</output></label>}
        <span className="grow" />
        <button className="btn small ghost" onClick={() => addTrack("video")}>+ Video track</button>
        <button className="btn small ghost" onClick={() => addTrack("audio")}>+ Audio track</button>
        <span className="sep" />
        <button className="btn small ghost" onClick={() => S().set({ pps: clamp(S().pps / 1.5, 2, 600) })} aria-label="Zoom out">−</button>
        <button className="btn small ghost" onClick={fit}>Fit</button>
        <button className="btn small ghost" onClick={() => S().set({ pps: clamp(S().pps * 1.5, 2, 600) })} aria-label="Zoom in">+</button>
      </div>
      <div className="tl-scroll" ref={scroller} onWheel={onWheel}>
        <div className="tl-grid" style={{ minWidth: "100%", width: width + HEAD, gridTemplateColumns: `${HEAD}px minmax(${width}px, 1fr)` }}>
          <div className="corner" style={{ height: RULER }} />
          <div className="ruler" style={{ height: RULER }} onPointerDown={e => onBgDown(e)} ref={lanes}>
            {ticks.map(s => <div key={s} className="tick" style={{ left: s * pps }}>{tc(s, project.fps).slice(0, 8)}</div>)}
          </div>
          {project.tracks.map(t => [
            <div key={`h${t.id}`} data-head={t.id} title="Drag up or down to reorder. Higher video tracks draw in front."
              className={`head ${t.kind}${t.id === trackId ? " sel" : ""}${trackDrag?.over === t.id ? (trackDrag.after ? " drop-after" : " drop-before") : ""}${trackDrag?.id === t.id ? " dragging" : ""}`}
              style={{ height: rowH(t) }} onPointerDown={e => onHeadDown(e, t)}
              onClick={() => S().set({ trackId: t.id })} onDoubleClick={() => setRenaming(t.id)}>
              {renaming === t.id
                ? <input autoFocus defaultValue={t.name} onBlur={e => { const v = e.target.value.trim(); if (v) S().commit(p => { p.tracks.find(x => x.id === t.id)!.name = v; }); setRenaming(null); }}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }} />
                : <span className="name">{t.name}</span>}
              <span className="row">
                <button className={`icon${t.muted ? " on" : ""}`} title={t.muted ? "Unmute track" : "Mute track"} onClick={e => { e.stopPropagation(); S().commit(p => { const x = p.tracks.find(y => y.id === t.id)!; x.muted = !x.muted; }); }}>
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2.5 6h2.5l3.5-3v10L5 10H2.5z" />{t.muted ? <path d="M11 6l3.5 4M14.5 6L11 10" /> : <path d="M11 5.5a3.5 3.5 0 010 5M12.8 3.8a6 6 0 010 8.4" />}</svg></button>
                <button className="icon" title="Delete track" onClick={e => { e.stopPropagation(); void deleteTrack(t.id); }}>
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg></button>
              </span>
            </div>,
            <div key={`l${t.id}`} className={`lane ${t.kind}`} data-track={t.id} style={{ height: rowH(t) }} onPointerDown={e => onBgDown(e, t)}
              onDragOver={e => { if (e.dataTransfer.types.includes("application/x-omni-media")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
              onDrop={e => onDrop(e, t)}>
              {insertAt?.track === t.id && <div className="insert-marker" style={{ left: insertAt.t * pps }} />}
              {project.clips.filter(c => c.track === t.id).map(c => {
                const m = media.get(c.mediaId), len = c.out - c.in;
                return (
                  <div key={c.id} className={`clip ${t.kind}${c.id === clipId ? " sel" : ""}${insertAt && c.id === clipId ? " inserting" : ""}${t.muted ? " muted" : ""}`}
                    style={{ left: c.start * pps, width: Math.max(2, len * pps) }}
                    onPointerDown={e => onClipDown(e, c)}
                    onPointerMove={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); (e.currentTarget as HTMLElement).style.cursor = e.clientX - r.left < EDGE || r.right - e.clientX < EDGE ? "ew-resize" : "default"; }}
                    title={m?.name}>
                    <span className="lbl">{m?.name ?? "Missing media"} <small>{tc(len, project.fps).slice(3)}</small></span>
                    {t.kind === "video" && m?.hasAudio && <span className="audio-band" />}
                  </div>
                );
              })}
            </div>,
          ])}
          <Playhead height={RULER + tracksH} />
        </div>
      </div>
    </section>
  );
}

function Playhead({ height }: { height: number }) {
  const t = useStore(s => s.time), pps = useStore(s => s.pps);
  return <div className="playhead" style={{ left: HEAD + t * pps, height }} />;
}
