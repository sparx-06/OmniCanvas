import type { Layer, LayerSource, Layout, Project, Track } from "./types";
import { cropRect, sourceSize, uid } from "../util";

/** A layer that shows its whole source, fitted inside the layout (OBS "Fit to screen"). */
export function fitLayer(name: string, source: LayerSource, sw: number, sh: number, lw: number, lh: number): Layer {
  const s = Math.min(lw / sw, lh / sh), w = Math.round(sw * s), h = Math.round(sh * s);
  return { id: uid(), name, source, visible: true, locked: false,
    x: Math.round((lw - w) / 2), y: Math.round((lh - h) / 2), w, h, crop: { l: 0, t: 0, r: 0, b: 0 } };
}

export function fitToScreen(p: Project, l: Layer, lw: number, lh: number): Partial<Layer> {
  const ss = sourceSize(p), c = cropRect(l, ss.w, ss.h);
  const s = Math.min(lw / c.w, lh / c.h), w = Math.round(c.w * s), h = Math.round(c.h * s);
  return { x: Math.round((lw - w) / 2), y: Math.round((lh - h) / 2), w, h };
}

const track = (trackId: string): LayerSource => ({ type: "track", trackId });

export function horizontalLayout(pw: number, ph: number, trackId: string): Layout {
  return { id: uid(), name: "Horizontal", width: 1920, height: 1080, background: "#000000",
    layers: [fitLayer("Gameplay", track(trackId), pw, ph, 1920, 1080)] };
}

/**
 * Vertical starting point: two uncropped copies of the same track, stacked.
 * The app never guesses a crop. The user crops each copy (Alt-drag) and
 * resizes it into place: typically the facecam on top and gameplay below.
 */
export function verticalLayout(pw: number, ph: number, trackId: string): Layout {
  const W = 1080, H = 1920, h = Math.round(W * ph / pw);
  const base = { source: track(trackId), visible: true, locked: false, w: W, h, crop: { l: 0, t: 0, r: 0, b: 0 } };
  return { id: uid(), name: "Vertical", width: W, height: H, background: "#0b0c0f",
    layers: [{ ...base, id: uid(), name: "Gameplay", x: 0, y: h }, { ...base, id: uid(), name: "Facecam", x: 0, y: 0 }] };
}

export function defaultTracks(): Track[] {
  return [{ id: "v1", kind: "video", name: "Video 1", muted: false }, { id: "a1", kind: "audio", name: "Audio 1", muted: false }];
}

/** A layout with no layers yet. Layers appear once a video track has a clip. */
export function emptyLayout(name: string, width: number, height: number, background = "#000000"): Layout {
  return { id: uid(), name, width, height, background, layers: [] };
}

export function newProject(): Project {
  return { version: 2, name: "Untitled", width: 1920, height: 1080, fps: 60, media: [], tracks: defaultTracks(), clips: [],
    layouts: [emptyLayout("Horizontal", 1920, 1080), emptyLayout("Vertical", 1080, 1920, "#0b0c0f")] };
}

/**
 * Layers for a video track that just got its first clip, added to every layout
 * that doesn't show that track yet. Uncropped: the user crops them.
 * An empty portrait layout gets two stacked copies, ready for facecam and gameplay.
 */
export function layersForNewTrack(p: Project, trackId: string, name: string) {
  for (const lo of p.layouts) {
    if (lo.layers.some(l => l.source.type === "track" && l.source.trackId === trackId)) continue;
    const src = { type: "track" as const, trackId };
    if (!lo.layers.length && lo.height > lo.width) {
      const h = Math.round(lo.width * p.height / p.width);
      const base = { source: src, visible: true, locked: false, w: lo.width, h, crop: { l: 0, t: 0, r: 0, b: 0 } };
      lo.layers.push({ ...base, id: uid(), name: `${name} (bottom)`, x: 0, y: h }, { ...base, id: uid(), name: `${name} (top)`, x: 0, y: 0 });
    } else {
      lo.layers.push(fitLayer(name, src, p.width, p.height, lo.width, lo.height));
    }
  }
}

/** Change the program size and keep every track crop on the same part of the picture. */
export function resizeProgram(p: Project, w: number, h: number) {
  const fx = w / p.width, fy = h / p.height, aspectChanged = Math.abs(w / h - p.width / p.height) > 0.01;
  for (const s of p.layouts) for (const l of s.layers) {
    const uncropped = !l.crop.l && !l.crop.r && !l.crop.t && !l.crop.b;
    l.crop = { l: Math.round(l.crop.l * fx), r: Math.round(l.crop.r * fx), t: Math.round(l.crop.t * fy), b: Math.round(l.crop.b * fy) };
    // An uncropped layer keeps the recording's shape when that shape changes.
    if (uncropped && aspectChanged) l.h = Math.round(l.w * h / w);
  }
  p.width = w; p.height = h;
}

/**
 * Fill in anything missing so older or hand-edited project files still open.
 * Version 1 files had "scenes", a fixed "video"/"music" track pair, and layers
 * that always showed the video track.
 */
export function normalizeProject(raw: any): Project {
  const d = newProject();
  if (!raw || typeof raw !== "object") return d;
  const tracks: Track[] = Array.isArray(raw.tracks) && raw.tracks.length
    ? raw.tracks.map((t: any) => ({ id: String(t.id), kind: t.kind === "audio" ? "audio" : "video", name: String(t.name || "Track"), muted: !!t.muted }))
    : defaultTracks();
  if (!tracks.some(t => t.kind === "video")) tracks.unshift({ id: uid(), kind: "video", name: "Video 1", muted: false });
  const firstVideo = tracks.find(t => t.kind === "video")!.id;
  const firstAudio = tracks.find(t => t.kind === "audio")?.id;
  const legacyTrack = (t: string) => t === "video" ? firstVideo : t === "music" ? (firstAudio ?? firstVideo) : t;

  const media = Array.isArray(raw.media) ? raw.media : [];
  const mediaIds = new Set(media.map((m: any) => m.id));
  const trackIds = new Set(tracks.map(t => t.id));
  const clips = (Array.isArray(raw.clips) ? raw.clips : [])
    .map((c: any) => ({ ...c, track: legacyTrack(String(c.track)), volume: Number.isFinite(c.volume) ? c.volume : 1 }))
    .filter((c: any) => mediaIds.has(c.mediaId) && trackIds.has(c.track));

  const width = +raw.width || d.width, height = +raw.height || d.height;
  const rawLayouts = Array.isArray(raw.layouts) ? raw.layouts : Array.isArray(raw.scenes) ? raw.scenes : [];

  // Early version-2 files could show a file directly in a layer. Each such file
  // becomes an image or video clip on its own track at the top of the timeline,
  // and the layer's crop is converted to program pixels (the file is fitted into
  // the program frame, the same way every clip is).
  const fileTracks = new Map<string, string>();
  const end = Math.max(5, ...clips.map((c: any) => c.start + c.out - c.in));
  const layouts: Layout[] = rawLayouts.length ? rawLayouts.map((s: any) => ({
    ...s,
    layers: (Array.isArray(s.layers) ? s.layers : []).map((l: any) => {
      const src = l.source && typeof l.source === "object" ? l.source : null;
      if (src?.type === "track" && trackIds.has(src.trackId)) return { ...l, source: { type: "track", trackId: src.trackId } };
      if (src?.type === "media") {
        const m = media.find((x: any) => x.id === src.mediaId);
        if (!m) return null;
        let tid = fileTracks.get(m.id);
        if (!tid) {
          tid = uid(); fileTracks.set(m.id, tid);
          tracks.unshift({ id: tid, kind: "video", name: m.name, muted: true });
          clips.push({ id: uid(), mediaId: m.id, track: tid, start: 0, in: 0, out: m.kind === "image" ? end : (m.duration || end), volume: 1 });
        }
        const mw = m.width || width, mh = m.height || height, k = Math.min(width / mw, height / mh);
        const ox = (width - mw * k) / 2, oy = (height - mh * k) / 2, c = l.crop || { l: 0, t: 0, r: 0, b: 0 };
        return { ...l, source: { type: "track", trackId: tid },
          crop: { l: Math.round(ox + c.l * k), r: Math.round(ox + c.r * k), t: Math.round(oy + c.t * k), b: Math.round(oy + c.b * k) } };
      }
      return { ...l, source: { type: "track", trackId: firstVideo } };
    }).filter(Boolean),
  })) : d.layouts;

  return {
    version: 2,
    name: typeof raw.name === "string" ? raw.name : d.name,
    width, height, fps: +raw.fps || d.fps,
    media, tracks, clips, layouts,
  };
}
