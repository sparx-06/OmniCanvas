// Preview playback. One hidden <video> element per media item and track keeps
// decoding cheap. Each video track is drawn into its own transparent canvas,
// the same frame the exporter builds as [T_<track>]; every layout preview then
// draws its layers out of those canvases (or out of a file, for file layers).
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Layout, Media, Track } from "../model/types";
import { S, useStore } from "../store";
import { clamp, clipAt, clipEnd, cropRect, orderedLayers, projectDuration, sourceSize } from "../util";

type El = HTMLVideoElement | HTMLImageElement;

const ready = (el: El) => el instanceof HTMLVideoElement ? el.readyState >= 2 : el.complete && el.naturalWidth > 0;
const dims = (el: El) => el instanceof HTMLVideoElement ? [el.videoWidth, el.videoHeight] : [el.naturalWidth, el.naturalHeight];

class Player {
  private els = new Map<string, El>();
  private host: HTMLDivElement;
  private canvases = new Map<string, HTMLCanvasElement>();
  private views = new Set<() => void>();
  private base = 0;
  private startT = 0;
  onMediaError: (m: Media) => void = () => {};

  constructor() {
    this.host = document.createElement("div");
    this.host.style.cssText = "position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-10px;top:-10px";
    document.body.appendChild(this.host);
  }

  addView(fn: () => void) { this.views.add(fn); fn(); return () => { this.views.delete(fn); }; }

  /** The program canvas of one video track. */
  trackCanvas(trackId: string): HTMLCanvasElement {
    let c = this.canvases.get(trackId);
    if (!c) { c = document.createElement("canvas"); this.canvases.set(trackId, c); }
    return c;
  }

  /** Drop elements whose file changed (for example after a preview copy is made). */
  refresh(mediaId: string) {
    for (const [k, el] of this.els) if (k.startsWith(mediaId + "#")) { el.remove(); this.els.delete(k); }
    this.seek(S().time);
  }

  /** One element per media item and track. */
  private element(m: Media, role: string): El {
    const key = `${m.id}#${role}#${m.proxyPath ?? m.path}`;
    let el = this.els.get(key);
    if (el) return el;
    for (const [k, old] of this.els) if (k.startsWith(`${m.id}#${role}#`)) { old.remove(); this.els.delete(k); }
    if (m.kind === "image") {
      const img = new Image();
      img.onload = () => this.draw();
      img.src = convertFileSrc(m.path);
      el = img;
    } else {
      const v = document.createElement("video");
      v.preload = "auto"; v.playsInline = true;
      v.addEventListener("loadeddata", () => this.draw());
      v.addEventListener("seeked", () => this.draw());
      v.addEventListener("error", () => { if (!m.proxyPath) this.onMediaError(m); });
      v.src = convertFileSrc(m.proxyPath ?? m.path);
      el = v;
    }
    this.host.appendChild(el);
    this.els.set(key, el);
    return el;
  }

  private mediaOf(id: string) { return S().project.media.find(m => m.id === id); }

  // ---- transport ----
  play() {
    const st = S(); if (st.playing) return;
    const total = projectDuration(st.project); if (!total) return;
    const t = st.time >= total - 0.01 ? 0 : st.time;
    this.startT = t;
    this.base = performance.now() - t * 1000;
    useStore.setState({ playing: true, time: t });
    requestAnimationFrame(this.tick);
  }

  /** Space in Vegas: stop and return to where playback started. Enter: pause in place. */
  stop(returnToStart: boolean) {
    if (!S().playing) return;
    useStore.setState({ playing: false });
    this.pauseAll();
    this.seek(returnToStart ? this.startT : S().time);
  }

  seek(t: number) {
    const st = S(), p = st.project, total = projectDuration(p);
    t = clamp(t, 0, Math.max(total, 0));
    useStore.setState({ time: t });
    if (st.playing) { this.base = performance.now() - t * 1000; return; }
    for (const tr of p.tracks) {
      const c = clipAt(p, tr.id, t), m = c && this.mediaOf(c.mediaId);
      if (c && m && m.kind !== "image") {
        const v = this.element(m, tr.id) as HTMLVideoElement;
        const want = c.in + (t - c.start);
        if (Math.abs(v.currentTime - want) > 0.004) v.currentTime = want;
      }
    }
    this.draw();
  }

  private pauseAll(except: El[] = []) {
    for (const el of this.els.values()) if (el instanceof HTMLVideoElement && !el.paused && !except.includes(el)) el.pause();
  }

  private tick = (now: number) => {
    const st = S(); if (!st.playing) return;
    const p = st.project;
    let t = (now - this.base) / 1000;
    const total = projectDuration(p);
    const active: El[] = [];
    let mastered = false;
    for (const tr of p.tracks) {
      const c = clipAt(p, tr.id, t), m = c && this.mediaOf(c.mediaId);
      if (!c || !m || m.kind === "image") continue;
      const v = this.element(m, tr.id) as HTMLVideoElement;
      active.push(v);
      v.muted = tr.muted;
      v.volume = clamp(c.volume ?? 1, 0, 1);
      const want = c.in + (t - c.start);
      if (v.paused) { if (Math.abs(v.currentTime - want) > 0.05) v.currentTime = want; v.play().catch(() => {}); }
      else if (!v.seeking) {
        const vt = c.start + (v.currentTime - c.in);
        if (Math.abs(vt - t) > 0.25) v.currentTime = want;
        else if (!mastered && tr.kind === "video" && vt < clipEnd(c)) { t = vt; this.base = now - t * 1000; mastered = true; }
      }
    }
    this.pauseAll(active);
    if (t >= total) { useStore.setState({ playing: false, time: total }); this.pauseAll(); this.draw(); return; }
    useStore.setState({ time: t });
    this.draw();
    requestAnimationFrame(this.tick);
  };

  // ---- drawing ----
  private drawTrack(tr: Track) {
    const st = S(), p = st.project, c = this.trackCanvas(tr.id);
    if (c.width !== p.width || c.height !== p.height) { c.width = p.width; c.height = p.height; }
    const x = c.getContext("2d")!;
    x.clearRect(0, 0, c.width, c.height);   // gaps are transparent, as in the export
    const clip = clipAt(p, tr.id, st.time), m = clip && this.mediaOf(clip.mediaId);
    if (!clip || !m || m.kind === "audio") return;
    const el = this.element(m, tr.id);
    if (!ready(el)) return;
    const [iw, ih] = dims(el);
    const s = Math.min(p.width / iw, p.height / ih), w = iw * s, h = ih * s;
    x.drawImage(el, (p.width - w) / 2, (p.height - h) / 2, w, h);
  }

  draw() {
    for (const tr of S().project.tracks) if (tr.kind === "video") this.drawTrack(tr);
    for (const v of this.views) v();
  }

}

export const player = new Player();

/** Draw a layout into a 2D context at the given scale (canvas px per layout px). */
export function drawLayout(ctx: CanvasRenderingContext2D, layout: Layout, scale: number) {
  const p = S().project, ss = sourceSize(p);
  ctx.fillStyle = layout.background || "#000";
  ctx.fillRect(0, 0, layout.width * scale, layout.height * scale);
  ctx.imageSmoothingQuality = "high";
  for (const l of orderedLayers(p, layout)) {
    if (!l.visible || l.w < 1 || l.h < 1) continue;
    const c = cropRect(l, ss.w, ss.h);
    ctx.drawImage(player.trackCanvas(l.source.trackId), c.x, c.y, c.w, c.h, l.x * scale, l.y * scale, l.w * scale, l.h * scale);
  }
}
