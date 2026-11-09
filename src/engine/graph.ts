// Builds the FFmpeg command that renders one layout from the shared timeline.
// Pure function: no Tauri imports, so it can be tested on its own.
//
// Pipeline:
//   1. Each video track that a visible layer shows becomes one stream, [T<n>]:
//      clips fitted into the program frame, gaps and letterbox bars transparent.
//   2. Audio: every unmuted video track's clip audio, plus every unmuted audio
//      track's clips placed at their start times, mixed into [aout].
//   3. The layout canvas is filled with its background, and each visible layer
//      crops its track and overlays it at its position and size, back to front in
//      timeline order (a higher track draws in front).

import type { Clip, Layout, Media, Project } from "../model/types";
import { clipEnd, cropRect, even, orderedLayers } from "../util";

export type Encoder = "nvenc" | "x264";

export interface RenderJob {
  inputs: string[];        // arguments that open the inputs
  filter: string;          // the filter graph, written to a script file
  output: string[];        // arguments after the filter graph
  duration: number;
}

const num = (n: number) => (Math.round(n * 1000) / 1000).toString();
const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? "0x" + c.slice(1) : "black");
const NORM = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";

export function buildRenderJob(p: Project, layout: Layout, outPath: string, enc: Encoder, quality = 19): RenderJob {
  const PW = even(p.width), PH = even(p.height), FPS = p.fps;
  const LW = even(layout.width), LH = even(layout.height);
  const media = new Map<string, Media>(p.media.map(m => [m.id, m]));
  const total = Math.max(0.04, ...p.clips.map(clipEnd));
  const T = num(total);

  const inputs: string[] = [];
  const f: string[] = [];
  let nIn = 0;
  const openClip = (m: Media, c: Clip) => {
    const d = c.out - c.in;
    if (m.kind === "image") inputs.push("-loop", "1", "-framerate", String(FPS), "-t", num(d), "-i", m.path);
    else inputs.push("-ss", num(c.in), "-t", num(d), "-i", m.path);
    return nIn++;
  };

  const videoIds = new Set(p.tracks.filter(t => t.kind === "video").map(t => t.id));
  const layers = orderedLayers(p, layout).filter(l => l.visible && l.w >= 1 && l.h >= 1 && videoIds.has(l.source.trackId));
  const keyOf = (l: (typeof layers)[number]) => `T_${l.source.trackId}`;
  const uses = new Map<string, number>();
  for (const l of layers) uses.set(keyOf(l), (uses.get(keyOf(l)) ?? 0) + 1);

  const fit = `scale=${PW}:${PH}:force_original_aspect_ratio=decrease,pad=${PW}:${PH}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1`;
  const clear = (d: string) => `color=c=black@0:s=${PW}x${PH}:r=${FPS}:d=${d},format=rgba,format=yuva420p,setsar=1`;
  const audioParts: string[] = [];

  // 1 and 2a. Video tracks.
  p.tracks.filter(t => t.kind === "video").forEach((tr, ti) => {
    const clips = p.clips.filter(c => c.track === tr.id).sort((a, b) => a.start - b.start);
    const needV = (uses.get(`T_${tr.id}`) ?? 0) > 0;
    const needA = !tr.muted && clips.some(c => media.get(c.mediaId)?.hasAudio);
    if (!needV && !needA) return;

    type Seg = { clip?: Clip; d: number };
    const segs: Seg[] = [];
    let t = 0;
    for (const c of clips) {
      if (c.start > t + 0.0005) segs.push({ d: c.start - t });
      const start = Math.max(c.start, t), d = clipEnd(c) - start;
      if (d > 0.0005) segs.push({ clip: { ...c, in: c.in + (start - c.start), start }, d });
      t = Math.max(t, clipEnd(c));
    }
    if (total > t + 0.0005) segs.push({ d: total - t });

    const labels: string[] = [];
    segs.forEach((s, k) => {
      const d = num(s.d), m = s.clip && media.get(s.clip.mediaId);
      const usable = s.clip && m && m.kind !== "audio";
      const i = usable ? openClip(m!, s.clip!) : -1;
      if (needV) {
        f.push(usable ? `[${i}:v:0]${fit},fps=${FPS},format=yuva420p,trim=duration=${d},setpts=PTS-STARTPTS[t${ti}v${k}]` : `${clear(d)}[t${ti}v${k}]`);
        labels.push(`[t${ti}v${k}]`);
      }
      if (needA) {
        f.push(usable && m!.hasAudio
          ? `[${i}:a:0]${NORM},volume=${num(s.clip!.volume ?? 1)},apad=whole_dur=${d},atrim=duration=${d},asetpts=PTS-STARTPTS[t${ti}a${k}]`
          : `anullsrc=r=48000:cl=stereo,atrim=duration=${d}[t${ti}a${k}]`);
        labels.push(`[t${ti}a${k}]`);
      }
    });
    const outs = `${needV ? `[T_${tr.id}]` : ""}${needA ? `[A_${tr.id}]` : ""}`;
    f.push(`${labels.join("")}concat=n=${segs.length}:v=${needV ? 1 : 0}:a=${needA ? 1 : 0}${outs}`);
    if (needA) audioParts.push(`[A_${tr.id}]`);
  });

  // 2b. Audio tracks.
  p.tracks.filter(t => t.kind === "audio" && !t.muted).forEach((tr, ti) => {
    p.clips.filter(c => c.track === tr.id).forEach((c, j) => {
      const m = media.get(c.mediaId);
      if (!m || !m.hasAudio) return;
      const i = openClip(m, c);
      f.push(`[${i}:a:0]${NORM},volume=${num(c.volume ?? 1)},asetpts=PTS-STARTPTS,adelay=delays=${Math.round(c.start * 1000)}:all=1[u${ti}c${j}]`);
      audioParts.push(`[u${ti}c${j}]`);
    });
  });
  if (!audioParts.length) f.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${T}[aout]`);
  else if (audioParts.length === 1) f.push(`${audioParts[0]}apad=whole_dur=${T},atrim=duration=${T}[aout]`);
  else f.push(`${audioParts.join("")}amix=inputs=${audioParts.length}:duration=longest:normalize=0,apad=whole_dur=${T},atrim=duration=${T}[aout]`);

  // Split each source once per layer that uses it.
  const next = new Map<string, number>();
  for (const [key, n] of uses) if (n > 1) f.push(`[${key}]split=${n}${Array.from({ length: n }, (_, k) => `[${key}_${k}]`).join("")}`);
  const take = (key: string) => {
    if ((uses.get(key) ?? 0) < 2) return `[${key}]`;
    const k = next.get(key) ?? 0; next.set(key, k + 1); return `[${key}_${k}]`;
  };

  // 3. Layout composition.
  f.push(`color=c=${hex(layout.background)}:s=${LW}x${LH}:r=${FPS}:d=${T},format=yuv420p[bg0]`);
  layers.forEach((l, k) => {
    const c = cropRect(l, PW, PH);
    f.push(`${take(keyOf(l))}crop=${Math.round(c.w)}:${Math.round(c.h)}:${Math.round(c.x)}:${Math.round(c.y)},scale=${Math.max(1, Math.round(l.w))}:${Math.max(1, Math.round(l.h))}:flags=lanczos,setsar=1[l${k}]`);
    f.push(`[bg${k}][l${k}]overlay=x=${Math.round(l.x)}:y=${Math.round(l.y)}:shortest=1:format=auto[bg${k + 1}]`);
  });
  f.push(`[bg${layers.length}]format=yuv420p[vout]`);

  const video = enc === "nvenc"
    ? ["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", String(quality), "-b:v", "0", "-maxrate", "60M", "-bufsize", "120M", "-profile:v", "high"]
    : ["-c:v", "libx264", "-preset", "medium", "-crf", String(quality - 1), "-profile:v", "high"];
  const output = ["-map", "[vout]", "-map", "[aout]", ...video, "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", T,
    "-progress", "pipe:1", "-nostats", "-y", outPath];

  return { inputs, filter: f.join(";\n"), output, duration: total };
}

/** Arguments for a preview copy that any Windows WebView can play. */
export function proxyArgs(input: string, out: string, enc: Encoder): string[] {
  const v = enc === "nvenc"
    ? ["-c:v", "h264_nvenc", "-preset", "p3", "-cq", "24", "-b:v", "0"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "24"];
  return ["-hide_banner", "-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=-2:'min(720,ih)'",
    ...v, "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
    "-progress", "pipe:1", "-nostats", out];
}
