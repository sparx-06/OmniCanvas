// Editing actions shared by menus, shortcuts and panels.
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Clip, Media, TrackId } from "./model/types";
import { newProject, normalizeProject, resizeProgram, fitLayer } from "./model/defaults";
import { S, currentScene } from "./store";
import { probe, makeProxy } from "./engine/ffmpeg";
import { player } from "./engine/player";
import { clipAt, clipEnd, fileName, snapFrame, uid } from "./util";

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

export function trackAccepts(m: Media, track: TrackId) {
  return track === "video" ? m.kind !== "audio" : m.hasAudio;
}

/** Place a media item on a track at time t, moved right if it would overlap. */
export function addClip(mediaId: string, track: TrackId, at?: number) {
  const st = S(), m = st.project.media.find(x => x.id === mediaId);
  if (!m) return;
  if (!trackAccepts(m, track)) { st.notify(track === "video" ? "Audio files go on the Music track." : "This file has no audio."); return; }
  const same = st.project.clips.filter(c => c.track === track);
  let start = at ?? same.reduce((e, c) => Math.max(e, clipEnd(c)), 0);
  start = snapFrame(Math.max(0, start), st.project.fps);
  const len = m.duration || 5;
  for (const c of [...same].sort((a, b) => a.start - b.start)) if (start < clipEnd(c) && start + len > c.start) start = clipEnd(c);
  const clip: Clip = { id: uid(), mediaId, track, start, in: 0, out: len, volume: 1 };
  st.commit(p => { p.clips.push(clip); });
  st.set({ clipId: clip.id });
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
  if (st.layerId && st.mode === "scene") {
    const sc = currentScene(), id = st.layerId;
    st.commit(p => { const s = p.scenes.find(x => x.id === sc.id)!; s.layers = s.layers.filter(l => l.id !== id); });
    st.set({ layerId: null });
  }
}

export function addLayer() {
  const st = S(), sc = currentScene(), p = st.project;
  const l = fitLayer(`Video ${sc.layers.length + 1}`, p.width, p.height, sc.width, sc.height);
  st.commit(pr => { pr.scenes.find(x => x.id === sc.id)!.layers.push(l); });
  st.set({ layerId: l.id });
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

export function clipUnderCursor() { const st = S(); return clipAt(st.project, "video", st.time); }
