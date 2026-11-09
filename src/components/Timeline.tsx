// The timeline follows Vegas: a click anywhere moves the cursor (playhead) there,
// including a click on a clip. Drag a clip to move it, drag its edge to trim it.
// Mouse wheel zooms around the pointer; Shift+wheel scrolls.
import { useEffect, useRef, useState } from "react";
import { S, useStore } from "../store";
import { player } from "../engine/player";
import { addClip, deleteSelection, splitAtCursor, trackAccepts } from "../actions";
import type { Clip, TrackId } from "../model/types";
import { clamp, clipEnd, projectDuration, snapFrame, tc } from "../util";

const RULER = 26, ROW: Record<TrackId, number> = { video: 72, music: 48 };
const TRACKS: { id: TrackId; name: string }[] = [{ id: "video", name: "Video 1" }, { id: "music", name: "Music" }];
const EDGE = 7;

export function Timeline() {
  const project = useStore(s => s.project);
  const pps = useStore(s => s.pps);
  const clipId = useStore(s => s.clipId);
  const scroller = useRef<HTMLDivElement>(null);
  const [bad, setBad] = useState<string | null>(null);
  const total = projectDuration(project);
  const width = Math.max((total + 30) * pps, 600);
  const media = new Map(project.media.map(m => [m.id, m]));
  const sel = project.clips.find(c => c.id === clipId);

  const timeAt = (clientX: number) => {
    const r = scroller.current!.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + scroller.current!.scrollLeft) / S().pps);
  };

  // Click or drag on empty space or the ruler: move the cursor, clear the clip selection.
  const onBgDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    S().set({ clipId: null });
    player.seek(snapFrame(timeAt(e.clientX), S().project.fps));
    const el = e.currentTarget as HTMLElement;
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
    const fps = S().project.fps, x0 = e.clientX, o = { ...c };
    const m = S().project.media.find(x => x.id === c.mediaId)!;
    S().set({ clipId: c.id, layerId: null });
    if (mode === "move") player.seek(snapFrame(timeAt(e.clientX), fps));  // Vegas: clicking a clip moves the cursor too
    let started = false;
    el.setPointerCapture(e.pointerId);

    const others = () => S().project.clips.filter(x => x.id !== c.id);
    const snapTargets = () => [0, S().time, ...others().flatMap(x => [x.start, clipEnd(x)])];
    const snapT = (t: number) => {
      const tol = 8 / S().pps;
      let best = t, dist = tol;
      for (const s of snapTargets()) if (Math.abs(s - t) < dist) { best = s; dist = Math.abs(s - t); }
      return best;
    };
    const overlaps = (start: number, end: number) => others().some(x => x.track === c.track && start < clipEnd(x) - 1e-6 && end > x.start + 1e-6);

    const mv = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / S().pps;
      if (!started) { if (Math.abs(ev.clientX - x0) < 3) return; started = true; if (S().playing) player.stop(false); S().begin(); }
      const len = o.out - o.in;
      let patch: Partial<Clip> = {};
      if (mode === "move") {
        let start = snapFrame(Math.max(0, o.start + dt), fps);
        const a = snapT(start), b = snapT(start + len) - len;
        start = Math.abs(a - start) <= Math.abs(b - start) ? a : b;
        start = Math.max(0, start);
        patch = { start };
        setBad(overlaps(start, start + len) ? c.id : null);
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
    const up = () => {
      el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      if (!started) return;
      const cur = S().project.clips.find(x => x.id === c.id)!;
      if (mode === "move" && overlaps(cur.start, clipEnd(cur))) {
        S().live(p => { Object.assign(p.clips.find(x => x.id === c.id)!, { start: o.start }); });
        S().notify("Clips on the same track can't overlap. Move it to an empty spot.");
      }
      setBad(null);
      S().end();
      player.seek(S().time);
    };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };

  const onWheel = (e: React.WheelEvent) => {
    const sc = scroller.current!;
    if (e.shiftKey) { sc.scrollLeft += e.deltaY || e.deltaX; return; }
    const t = timeAt(e.clientX), r = sc.getBoundingClientRect();
    const next = clamp(S().pps * Math.exp(-e.deltaY * 0.0015), 2, 600);
    S().set({ pps: next });
    requestAnimationFrame(() => { sc.scrollLeft = t * next - (e.clientX - r.left); });
  };

  const onDrop = (e: React.DragEvent, track: TrackId) => {
    const id = e.dataTransfer.getData("application/x-omni-media");
    if (!id) return;
    e.preventDefault();
    addClip(id, track, snapFrame(timeAt(e.clientX), S().project.fps));
  };

  // Keep the cursor in view during playback.
  useEffect(() => useStore.subscribe((s, prev) => {
    if (!s.playing || s.time === prev.time || !scroller.current) return;
    const sc = scroller.current, x = s.time * s.pps;
    if (x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = x - 80;
  }), []);

  const fit = () => { const w = scroller.current!.clientWidth - 40; S().set({ pps: clamp(w / Math.max(total, 1), 2, 600) }); scroller.current!.scrollLeft = 0; };
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(s => s * pps >= 90) ?? 900;
  const ticks: number[] = [];
  for (let s = 0; s <= width / pps; s += step) ticks.push(s);

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
        <button className="btn small ghost" onClick={() => S().set({ pps: clamp(S().pps / 1.5, 2, 600) })} aria-label="Zoom out">−</button>
        <button className="btn small ghost" onClick={fit}>Fit</button>
        <button className="btn small ghost" onClick={() => S().set({ pps: clamp(S().pps * 1.5, 2, 600) })} aria-label="Zoom in">+</button>
      </div>
      <div className="tl-body">
        <div className="tl-heads">
          <div style={{ height: RULER }} />
          {TRACKS.map(t => <div key={t.id} className="head" style={{ height: ROW[t.id] }}>{t.name}</div>)}
        </div>
        <div className="tl-scroll" ref={scroller} onWheel={onWheel}>
          <div className="tl-inner" style={{ width }}>
            <div className="ruler" style={{ height: RULER }} onPointerDown={onBgDown}>
              {ticks.map(s => <div key={s} className="tick" style={{ left: s * pps }}>{tc(s, project.fps).slice(0, 8)}</div>)}
            </div>
            {TRACKS.map(t => (
              <div key={t.id} className={`lane ${t.id}`} style={{ height: ROW[t.id] }} onPointerDown={onBgDown}
                onDragOver={e => { if (e.dataTransfer.types.includes("application/x-omni-media")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
                onDrop={e => onDrop(e, t.id)}>
                {project.clips.filter(c => c.track === t.id).map(c => {
                  const m = media.get(c.mediaId);
                  const len = c.out - c.in;
                  return (
                    <div key={c.id} className={`clip ${t.id}${c.id === clipId ? " sel" : ""}${bad === c.id ? " bad" : ""}`}
                      style={{ left: c.start * pps, width: Math.max(2, len * pps) }}
                      onPointerDown={e => onClipDown(e, c)}
                      onPointerMove={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); (e.currentTarget as HTMLElement).style.cursor = e.clientX - r.left < EDGE || r.right - e.clientX < EDGE ? "ew-resize" : "default"; }}
                      title={m?.name}>
                      <span className="lbl">{m?.name ?? "Missing media"} <small>{tc(len, project.fps).slice(3)}</small></span>
                      {t.id === "video" && m?.hasAudio && <span className="audio-band" />}
                      {m && !trackAccepts(m, t.id) && <span className="lbl warn">Wrong track</span>}
                    </div>
                  );
                })}
              </div>
            ))}
            <Playhead />
          </div>
        </div>
      </div>
    </section>
  );
}

function Playhead() {
  const t = useStore(s => s.time), pps = useStore(s => s.pps);
  return <div className="playhead" style={{ left: t * pps }} />;
}
