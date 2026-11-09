import type { Clip, Layer, Project } from "./model/types";

export const uid = () => Math.random().toString(36).slice(2, 10);
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const pad = (n: number) => String(n).padStart(2, "0");

/** Timecode as HH:MM:SS:FF, the way Vegas shows it. */
export function tc(t: number, fps: number): string {
  const f = Math.max(0, Math.round(t * fps));
  const fr = f % Math.round(fps), s = Math.floor(f / Math.round(fps));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(fr)}`;
}
export const snapFrame = (t: number, fps: number) => Math.round(t * fps) / fps;
export const clipLen = (c: Clip) => c.out - c.in;
export const clipEnd = (c: Clip) => c.start + c.out - c.in;

export function projectDuration(p: Project): number {
  return p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}
export function clipAt(p: Project, track: Clip["track"], t: number): Clip | undefined {
  return p.clips.find(c => c.track === track && t >= c.start && t < clipEnd(c));
}

/** The part of the program frame a layer shows, clamped to the frame. */
export function cropRect(l: Layer, pw: number, ph: number) {
  const x = clamp(l.crop.l, 0, pw - 1), y = clamp(l.crop.t, 0, ph - 1);
  const w = clamp(pw - l.crop.l - l.crop.r, 1, pw - x), h = clamp(ph - l.crop.t - l.crop.b, 1, ph - y);
  return { x, y, w, h };
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
