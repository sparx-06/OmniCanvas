import type { Clip, Layer, LayerSource, Project, Track } from "./model/types";

export const uid = () => Math.random().toString(36).slice(2, 10);
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const pad = (n: number) => String(n).padStart(2, "0");

/** Timecode as HH:MM:SS:FF, the way Vegas shows it. */
export function tc(t: number, fps: number): string {
  const r = Math.round(fps) || 30;
  const f = Math.max(0, Math.round(t * fps));
  const fr = f % r, s = Math.floor(f / r);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(fr)}`;
}
export const snapFrame = (t: number, fps: number) => Math.round(t * fps) / fps;
export const clipLen = (c: Clip) => c.out - c.in;
export const clipEnd = (c: Clip) => c.start + c.out - c.in;

export function projectDuration(p: Project): number {
  return p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}
export function clipAt(p: Project, trackId: string, t: number): Clip | undefined {
  return p.clips.find(c => c.track === trackId && t >= c.start && t < clipEnd(c));
}
export const trackById = (p: Project, id: string): Track | undefined => p.tracks.find(t => t.id === id);
export const videoTracks = (p: Project) => p.tracks.filter(t => t.kind === "video");
export const audioTracks = (p: Project) => p.tracks.filter(t => t.kind === "audio");

/** Pixel size of what a layer crops from: the program frame. */
export function sourceSize(p: Project, _s?: LayerSource): { w: number; h: number } {
  return { w: p.width, h: p.height };
}

export function sourceLabel(p: Project, s: LayerSource): string {
  return trackById(p, s.trackId)?.name ?? "Missing track";
}

/**
 * Layers in drawing order, back to front. The timeline decides: a higher video
 * track draws in front of a lower one, in every layout. Between layers of the
 * same track, the layout's own list order decides.
 */
export function orderedLayers(p: Project, layout: { layers: Layer[] }): Layer[] {
  const rank = new Map(videoTracks(p).map((t, i) => [t.id, i]));   // 0 = top of the timeline = front
  const r = (l: Layer) => rank.get(l.source.trackId) ?? 1e9;
  return layout.layers.map((l, i) => ({ l, i })).sort((a, b) => r(b.l) - r(a.l) || a.i - b.i).map(x => x.l);
}

/** The part of the source a layer shows, clamped to the source. */
export function cropRect(l: Layer, sw: number, sh: number) {
  const x = clamp(l.crop.l, 0, sw - 1), y = clamp(l.crop.t, 0, sh - 1);
  const w = clamp(sw - l.crop.l - l.crop.r, 1, sw - x), h = clamp(sh - l.crop.t - l.crop.b, 1, sh - y);
  return { x, y, w, h };
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function nextTrackName(p: Project, kind: Track["kind"]): string {
  const base = kind === "video" ? "Video" : "Audio";
  let n = p.tracks.filter(t => t.kind === kind).length + 1;
  while (p.tracks.some(t => t.name === `${base} ${n}`)) n++;
  return `${base} ${n}`;
}
