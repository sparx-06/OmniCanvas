// Timeline edits that touch several clips at once. Pure functions on a project
// draft, so they can be tested without the UI.
import type { Clip, Project } from "./types";

const end = (c: Clip) => c.start + c.out - c.in;
const EPS = 1e-6;

/** Where a clip dropped at pointer time t onto clips would be inserted: an edge of the clip under t, or t itself in a gap. */
export function insertPoint(clips: Clip[], t: number): number {
  const under = clips.find(x => t >= x.start && t < end(x));
  if (!under) return t;
  return t < (under.start + end(under)) / 2 ? under.start : end(under);
}

/**
 * Drop a clip onto other clips: insert it and push the rest along.
 * 1. Lift it out of its original place and close the gap it leaves (clips after it move left).
 * 2. Insert it at the nearer edge of the clip under the pointer (or at the pointer in a gap).
 * 3. Clips at or after that point move right by the clip's length.
 * Splitting a clip in half and dropping the first half onto the second half swaps them.
 */
export function insertClip(p: Project, id: string, orig: { start: number; track: string }, pointerT: number, track: string) {
  const c = p.clips.find(x => x.id === id);
  if (!c) return;
  const len = c.out - c.in;
  for (const x of p.clips) if (x.id !== id && x.track === orig.track && x.start >= orig.start + len - EPS) x.start -= len;
  let t = pointerT;
  if (track === orig.track) {
    if (t >= orig.start + len) t -= len;
    else if (t > orig.start) t = orig.start;
  }
  const on = p.clips.filter(x => x.id !== id && x.track === track).sort((a, b) => a.start - b.start);
  const at = Math.max(0, insertPoint(on, t));
  for (const x of on) if (x.start >= at - EPS) x.start += len;
  c.track = track;
  c.start = at;
}
