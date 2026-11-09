// Editing actions shared by menus, shortcuts and panels.
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Clip, LayerSource, Media, Project, Track, TrackKind } from "./model/types";
import { newProject, normalizeProject, resizeProgram, fitLayer } from "./model/defaults";
import { S, currentLayout } from "./store";
import { probe, makeProxy } from "./engine/ffmpeg";
import { player } from "./engine/player";
import { clipEnd, fileName, nextTrackName, snapFrame, sourceLabel, sourceSize, trackById, uid } from "./util";

const MEDIA_EXT = ["mp4", "mkv", "mov", "m4v", "webm", "flv", "ts", "mp3", "wav", "m4a", "aac", "flac", "ogg", "png", "jpg", "jpeg", "webp"];

export async function importMedia() {
  const picked = await open({ multiple: true, filters: [{ name: "Video, audio and images", extensions: MEDIA_EXT }] });
  if (!picked) return;
  const paths = Array.isArray(picked) ? picked : [picked];
  for (const path of paths) {
    try {
      const m = await probe(path);
      const st = S();
      const firstVideo = m.kind === "video" && !st.project.media.some(x => x.kind === "video");
      st.commit(p => {
        p.media.push(m);
        // The first recording sets the program size, so crops line up with it.
        if (firstVideo && m.width && m.height && (m.width !== p.width || m.height !== p.height)) resizeProgram(p, m.width, m.height);
        if (firstVideo && m.fps >= 50) p.fps = Math.round(m.fps);
      });
      if (firstVideo) S().notify(`Program size set to ${m.width}×${m.height} to match ${m.name}.`);
    } catch (e) {
      S().notify(`Couldn't read ${fileName(path)}: ${String(e).slice(0, 140)}`);
    }
  }
}

/** Called when the WebView can't play a file: make a preview copy automatically. */
export async function ensureProxy(m: Media) {
  const st = S();
  if (st.proxyProgress[m.id] !== undefined) return;
  st.set({ proxyProgress: { ...st.proxyProgress, [m.id]: 0 } });
  st.notify(`Making a preview copy of ${m.name}. Export still uses the original file.`);
  try {
    const out = await makeProxy(m, f => S().set({ proxyProgress: { ...S().proxyProgress, [m.id]: f } }));
    S().live(p => { const x = p.media.find(y => y.id === m.id); if (x) x.proxyPath = out; });
    S().set({ dirty: true });
    player.refresh(m.id);
  } catch (e) {
    S().notify(`Couldn't make a preview copy of ${m.name}: ${String(e).slice(0, 160)}`);
  } finally {
    const pp = { ...S().proxyProgress }; delete pp[m.id]; S().set({ proxyProgress: pp });
  }
}
player.onMediaError = m => { void ensureProxy(m); };

/** Video tracks take video and images; audio tracks take anything with sound. */
export function trackAccepts(m: Media, kind: TrackKind) {
  return kind === "video" ? m.kind !== "audio" : m.hasAudio;
}

/** The selected track if it fits, otherwise the first track of that kind. */
export function targetTrack(kind: TrackKind): Track | undefined {
  const p = S().project, sel = S().trackId ? trackById(p, S().trackId!) : undefined;
  return sel && sel.kind === kind ? sel : p.tracks.find(t => t.kind === kind);
}

/** Place a media item on a track at time t, moved right if it would overlap. */
export function addClip(mediaId: string, trackId: string, at?: number) {
  const st = S(), p = st.project, m = p.media.find(x => x.id === mediaId), tr = trackById(p, trackId);
  if (!m || !tr) return;
  if (!trackAccepts(m, tr.kind)) { st.notify(tr.kind === "video" ? "Audio files go on an audio track." : "This file has no sound."); return; }
  const same = p.clips.filter(c => c.track === trackId);
  let start = at ?? same.reduce((e, c) => Math.max(e, clipEnd(c)), 0);
  start = snapFrame(Math.max(0, start), p.fps);
  const len = m.duration || 5;
  for (const c of [...same].sort((a, b) => a.start - b.start)) if (start < clipEnd(c) && start + len > c.start) start = clipEnd(c);
  const clip: Clip = { id: uid(), mediaId, track: trackId, start, in: 0, out: len, volume: 1 };
  st.commit(pr => { pr.clips.push(clip); });
  st.set({ clipId: clip.id, trackId });
}

/** Vegas "S": split the selected clip at the cursor, or every clip under the cursor. */
export function splitAtCursor() {
  const st = S(), t = snapFrame(st.time, st.project.fps);
  const sel = st.project.clips.find(c => c.id === st.clipId && t > c.start && t < clipEnd(c));
  const targets = sel ? [sel] : st.project.clips.filter(c => t > c.start + 0.001 && t < clipEnd(c) - 0.001);
  if (!targets.length) { st.notify("Put the cursor over a clip to split it."); return; }
  st.commit(p => {
    for (const tgt of targets) {
      const c = p.clips.find(x => x.id === tgt.id)!;
      const cut = c.in + (t - c.start);
      p.clips.push({ ...c, id: uid(), start: t, in: cut });
      c.out = cut;
    }
  });
}

export function deleteSelection() {
  const st = S();
  if (st.clipId) { const id = st.clipId; st.commit(p => { p.clips = p.clips.filter(c => c.id !== id); }); st.set({ clipId: null }); return; }
  if (st.layerId && st.mode === "layout") {
    const lo = currentLayout(), id = st.layerId;
    st.commit(p => { const s = p.layouts.find(x => x.id === lo.id)!; s.layers = s.layers.filter(l => l.id !== id); });
    st.set({ layerId: null });
  }
}

// ---- tracks ----

function newTrack(p: Project, kind: TrackKind): Track {
  const t: Track = { id: uid(), kind, name: nextTrackName(p, kind), muted: false };
  // Keep video tracks above audio tracks, like Vegas.
  const idx = kind === "video" ? p.tracks.filter(x => x.kind === "video").length : p.tracks.length;
  p.tracks.splice(idx, 0, t);
  return t;
}

/**
 * Add a track. A new video track also gets a layer on top of every layout, so
 * what is placed on it shows up straight away; the layer can be removed.
 */
export function addTrack(kind: TrackKind) {
  let id = "";
  S().commit(p => {
    const t = newTrack(p, kind); id = t.id;
    if (kind === "video") for (const lo of p.layouts)
      lo.layers.push(fitLayer(t.name, { type: "track", trackId: t.id }, p.width, p.height, lo.width, lo.height));
  });
  S().set({ trackId: id });
}

export async function deleteTrack(id: string) {
  const p = S().project, t = trackById(p, id);
  if (!t) return;
  if (t.kind === "video" && p.tracks.filter(x => x.kind === "video").length === 1) { S().notify("Keep at least one video track."); return; }
  const n = p.clips.filter(c => c.track === id).length;
  const layers = p.layouts.flatMap(lo => lo.layers).filter(l => l.source.type === "track" && l.source.trackId === id).length;
  if (n || layers) {
    const parts = [n ? `${n} clip${n > 1 ? "s" : ""}` : "", layers ? `${layers} layer${layers > 1 ? "s" : ""} that show it` : ""].filter(Boolean).join(" and ");
    if (!(await ask(`Delete ${t.name} and its ${parts}? You can undo this.`, { title: "OmniCanvas", kind: "warning" }))) return;
  }
  S().commit(pr => {
    pr.tracks = pr.tracks.filter(x => x.id !== id);
    pr.clips = pr.clips.filter(c => c.track !== id);
    for (const lo of pr.layouts) lo.layers = lo.layers.filter(l => !(l.source.type === "track" && l.source.trackId === id));
  });
  S().set({ trackId: null, clipId: null, layerId: null });
}

// ---- layers ----

/**
 * Add a layer to the current layout, like OBS "Add source": an existing video
 * track, a new video track, or one file shown for the whole video.
 */
export function addLayer(choice: { type: "track"; trackId: string } | { type: "newTrack" } | { type: "media"; mediaId: string }) {
  const lo = currentLayout();
  let layerId = "";
  S().commit(p => {
    let source: LayerSource;
    if (choice.type === "newTrack") source = { type: "track", trackId: newTrack(p, "video").id };
    else source = choice;
    const ss = sourceSize(p, source);
    const l = fitLayer(sourceLabel(p, source), source, ss.w, ss.h, lo.width, lo.height);
    p.layouts.find(x => x.id === lo.id)!.layers.push(l);
    layerId = l.id;
  });
  S().set({ layerId, clipId: null, mode: "layout" });
}

/** Point a layer at a different source. The crop is reset when the source size changes. */
export function setLayerSource(layoutId: string, layerId: string, source: LayerSource) {
  S().commit(p => {
    const l = p.layouts.find(x => x.id === layoutId)?.layers.find(x => x.id === layerId);
    if (!l) return;
    const a = sourceSize(p, l.source), b = sourceSize(p, source);
    l.source = source;
    if (a.w !== b.w || a.h !== b.h) l.crop = { l: 0, t: 0, r: 0, b: 0 };
  });
}

// ---- project files ----
export async function newDoc() {
  if (S().dirty && !(await confirmDiscard())) return;
  const p = newProject();
  S().load(p, null);
  player.seek(0);
}

function confirmDiscard() { return ask("This project has unsaved changes. Discard them?", { title: "OmniCanvas", kind: "warning" }); }

export async function openDoc() {
  if (S().dirty && !(await confirmDiscard())) return;
  const path = await open({ multiple: false, filters: [{ name: "OmniCanvas project", extensions: ["omni", "json"] }] });
  if (!path || Array.isArray(path)) return;
  try {
    const p = normalizeProject(JSON.parse(await readTextFile(path)));
    S().load(p, path);
    player.seek(0);
  } catch (e) { S().notify(`Couldn't open the project: ${String(e).slice(0, 140)}`); }
}

export async function saveDoc(as = false) {
  const st = S();
  let path = st.path;
  if (!path || as) {
    const picked = await save({ defaultPath: `${st.project.name || "Untitled"}.omni`, filters: [{ name: "OmniCanvas project", extensions: ["omni"] }] });
    if (!picked) return;
    path = picked;
  }
  await writeTextFile(path, JSON.stringify(st.project, null, 2));
  st.set({ path, dirty: false });
  st.notify(`Saved ${fileName(path)}.`);
}
