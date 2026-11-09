import type { Layer, Project, Scene } from "./types";
import { cropRect, uid } from "../util";

/** A layer that shows the whole program frame, fitted inside the scene (OBS "Fit to screen"). */
export function fitLayer(name: string, pw: number, ph: number, sw: number, sh: number): Layer {
  const s = Math.min(sw / pw, sh / ph), w = Math.round(pw * s), h = Math.round(ph * s);
  return { id: uid(), name, source: "program", visible: true, locked: false,
    x: Math.round((sw - w) / 2), y: Math.round((sh - h) / 2), w, h, crop: { l: 0, t: 0, r: 0, b: 0 } };
}

export function fitToScreen(l: Layer, pw: number, ph: number, sw: number, sh: number): Partial<Layer> {
  const c = cropRect(l, pw, ph), s = Math.min(sw / c.w, sh / c.h), w = Math.round(c.w * s), h = Math.round(c.h * s);
  return { x: Math.round((sw - w) / 2), y: Math.round((sh - h) / 2), w, h };
}

export function horizontalScene(pw: number, ph: number): Scene {
  return { id: uid(), name: "Horizontal", width: 1920, height: 1080, background: "#000000",
    layers: [fitLayer("Gameplay", pw, ph, 1920, 1080)] };
}

/**
 * Vertical starting point: two uncropped copies of the recording, stacked.
 * The app never guesses a crop. The user crops each copy (Alt-drag) and
 * resizes it into place: typically the facecam on top and gameplay below.
 */
export function verticalScene(pw: number, ph: number): Scene {
  const W = 1080, H = 1920, h = Math.round(W * ph / pw);
  const facecam: Layer = { id: uid(), name: "Facecam", source: "program", visible: true, locked: false,
    x: 0, y: 0, w: W, h, crop: { l: 0, t: 0, r: 0, b: 0 } };
  const gameplay: Layer = { id: uid(), name: "Gameplay", source: "program", visible: true, locked: false,
    x: 0, y: h, w: W, h, crop: { l: 0, t: 0, r: 0, b: 0 } };
  return { id: uid(), name: "Vertical", width: W, height: H, background: "#0b0c0f", layers: [gameplay, facecam] };
}

export function newProject(): Project {
  const pw = 1920, ph = 1080;
  return { version: 1, name: "Untitled", width: pw, height: ph, fps: 60, media: [], clips: [],
    scenes: [horizontalScene(pw, ph), verticalScene(pw, ph)] };
}

/** Change the program size and keep every crop on the same part of the picture. */
export function resizeProgram(p: Project, w: number, h: number) {
  const fx = w / p.width, fy = h / p.height, aspectChanged = Math.abs(w / h - p.width / p.height) > 0.01;
  for (const s of p.scenes) for (const l of s.layers) {
    const uncropped = !l.crop.l && !l.crop.r && !l.crop.t && !l.crop.b;
    l.crop = { l: Math.round(l.crop.l * fx), r: Math.round(l.crop.r * fx), t: Math.round(l.crop.t * fy), b: Math.round(l.crop.b * fy) };
    // An uncropped layer keeps the recording's shape when that shape changes.
    if (uncropped && aspectChanged) l.h = Math.round(l.w * h / w);
  }
  p.width = w; p.height = h;
}

/** Fill in anything missing so older or hand-edited project files still open. */
export function normalizeProject(raw: any): Project {
  const d = newProject();
  if (!raw || typeof raw !== "object") return d;
  const p: Project = {
    version: 1,
    name: typeof raw.name === "string" ? raw.name : d.name,
    width: +raw.width || d.width, height: +raw.height || d.height, fps: +raw.fps || d.fps,
    media: Array.isArray(raw.media) ? raw.media : [],
    clips: Array.isArray(raw.clips) ? raw.clips : [],
    scenes: Array.isArray(raw.scenes) && raw.scenes.length ? raw.scenes : d.scenes,
  };
  const ids = new Set(p.media.map(m => m.id));
  p.clips = p.clips.filter(c => ids.has(c.mediaId)).map(c => ({ ...c, volume: Number.isFinite(c.volume) ? c.volume : 1 }));
  return p;
}
