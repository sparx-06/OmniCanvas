// Preview playback. One hidden <video> element per media item and track keeps
// decoding cheap; the active clip's element is drawn into the program canvas,
// and every scene preview draws its layers out of that program canvas, the
// same way the exporter crops [prog].
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Clip, Media, Scene } from "../model/types";
import { S, useStore } from "../store";
import { clamp, clipAt, clipEnd, cropRect, projectDuration } from "../util";

type El = HTMLVideoElement | HTMLImageElement;

class Player {
  private els = new Map<string, El>();
  private host: HTMLDivElement;
  readonly program = document.createElement("canvas");
  private pctx = this.program.getContext("2d")!;
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

  /** Drop elements whose file changed (for example after a preview copy is made). */
  refresh(mediaId: string) {
    for (const [k, el] of this.els) if (k.startsWith(mediaId + "#")) { el.remove(); this.els.delete(k); }
    this.seek(S().time);
  }

  private element(m: Media, role: "v" | "m"): El {
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

  private media(c?: Clip) { return c ? S().project.media.find(m => m.id === c.mediaId) : undefined; }

  // ---- transport ----
  get playing() { return S().playing; }

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
    const st = S(), total = projectDuration(st.project);
    t = clamp(t, 0, Math.max(total, 0));
    useStore.setState({ time: t });
    if (st.playing) { this.base = performance.now() - t * 1000; return; }
    for (const track of ["video", "music"] as const) {
      const c = clipAt(st.project, track, t), m = this.media(c);
      if (c && m && m.kind !== "image") {
        const v = this.element(m, track === "video" ? "v" : "m") as HTMLVideoElement;
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
    let t = (now - this.base) / 1000;
    const total = projectDuration(st.project);
    const active: El[] = [];
    for (const track of ["video", "music"] as const) {
      const c = clipAt(st.project, track, t), m = this.media(c);
      if (!c || !m || m.kind === "image") continue;
      const v = this.element(m, track === "video" ? "v" : "m") as HTMLVideoElement;
      active.push(v);
      v.volume = clamp(c.volume ?? 1, 0, 1);
      const want = c.in + (t - c.start);
      if (v.paused) { if (Math.abs(v.currentTime - want) > 0.05) v.currentTime = want; v.play().catch(() => {}); }
      else if (!v.seeking) {
        const vt = c.start + (v.currentTime - c.in);
        if (Math.abs(vt - t) > 0.25) v.currentTime = want;
        else if (track === "video" && vt < clipEnd(c)) { t = vt; this.base = now - t * 1000; }
      }
    }
    this.pauseAll(active);
    if (t >= total) { useStore.setState({ playing: false, time: total }); this.pauseAll(); this.draw(); return; }
    useStore.setState({ time: t });
    this.draw();
    requestAnimationFrame(this.tick);
  };

  // ---- drawing ----
  draw() {
    const st = S(), p = st.project;
    if (this.program.width !== p.width || this.program.height !== p.height) { this.program.width = p.width; this.program.height = p.height; }
    const x = this.pctx;
    x.fillStyle = "#000"; x.fillRect(0, 0, p.width, p.height);
    const c = clipAt(p, "video", st.time), m = this.media(c);
    if (c && m && m.kind !== "audio") {
      const el = this.element(m, "v");
      const ready = el instanceof HTMLVideoElement ? el.readyState >= 2 : el.complete && el.naturalWidth > 0;
      if (ready) {
        const iw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
        const ih = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
        // Same as the exporter: fit inside the program frame, keep aspect, black bars.
        const s = Math.min(p.width / iw, p.height / ih), w = iw * s, h = ih * s;
        x.drawImage(el, (p.width - w) / 2, (p.height - h) / 2, w, h);
      }
    }
    for (const v of this.views) v();
  }
}

export const player = new Player();

/** Draw a scene into a 2D context at the given scale (canvas px per scene px). */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, scale: number) {
  const p = S().project, prog = player.program;
  ctx.fillStyle = scene.background || "#000";
  ctx.fillRect(0, 0, scene.width * scale, scene.height * scale);
  ctx.imageSmoothingQuality = "high";
  for (const l of scene.layers) {
    if (!l.visible || l.w < 1 || l.h < 1) continue;
    const c = cropRect(l, p.width, p.height);
    ctx.drawImage(prog, c.x, c.y, c.w, c.h, l.x * scale, l.y * scale, l.w * scale, l.h * scale);
  }
}
