// Builds the FFmpeg command that renders one scene from the shared timeline.
// Pure function: no Tauri imports, so it can be tested on its own.
//
// Pipeline:
//   1. Every video-track clip is fitted into the program frame (letterboxed like
//      the preview), gaps become black, and everything is joined into [prog].
//   2. Clip audio is joined the same way, then music-track clips are mixed in.
//   3. The scene canvas is filled with its background, and each visible layer
//      crops [prog] and overlays it at its position and size.

import type { Clip, Media, Project, Scene } from "../model/types";
import { clipEnd, cropRect, even } from "../util";

export type Encoder = "nvenc" | "x264";

export interface RenderJob {
  inputs: string[];        // arguments that open the inputs
  filter: string;          // the filter graph, written to a script file
  output: string[];        // arguments after the filter graph
  duration: number;
}

const num = (n: number) => (Math.round(n * 1000) / 1000).toString();
const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? "0x" + c.slice(1) : "black");

export function buildRenderJob(p: Project, scene: Scene, outPath: string, enc: Encoder, quality = 19): RenderJob {
  const PW = even(p.width), PH = even(p.height), FPS = p.fps;
  const SW = even(scene.width), SH = even(scene.height);
  const media = new Map<string, Media>(p.media.map(m => [m.id, m]));
  const vclips = p.clips.filter(c => c.track === "video").sort((a, b) => a.start - b.start);
  const mclips = p.clips.filter(c => c.track === "music").sort((a, b) => a.start - b.start);
  const total = Math.max(0.04, ...p.clips.map(clipEnd));

  const inputs: string[] = [];
  const f: string[] = [];
  let nIn = 0;
  const openInput = (m: Media, c: Clip) => {
    const d = c.out - c.in;
    if (m.kind === "image") inputs.push("-loop", "1", "-framerate", String(FPS), "-t", num(d), "-i", m.path);
    else inputs.push("-ss", num(c.in), "-t", num(d), "-i", m.path);
    return nIn++;
  };

  // 1 + 2a. Video track with its own audio, gaps filled.
  type Seg = { clip?: Clip; d: number };
  const segs: Seg[] = [];
  let t = 0;
  for (const c of vclips) {
    if (c.start > t + 0.0005) segs.push({ d: c.start - t });
    const start = Math.max(c.start, t);
    const d = clipEnd(c) - start;
    if (d > 0.0005) segs.push({ clip: { ...c, in: c.in + (start - c.start), start }, d });
    t = Math.max(t, clipEnd(c));
  }
  if (total > t + 0.0005) segs.push({ d: total - t });

  const fit = `scale=${PW}:${PH}:force_original_aspect_ratio=decrease,pad=${PW}:${PH}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  const norm = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  segs.forEach((s, k) => {
    const d = num(s.d);
    const m = s.clip && media.get(s.clip.mediaId);
    if (s.clip && m && m.hasVideo !== false && m.kind !== "audio") {
      const i = openInput(m, s.clip);
      f.push(`[${i}:v:0]${fit},fps=${FPS},format=yuv420p,trim=duration=${d},setpts=PTS-STARTPTS[v${k}]`);
      if (m.hasAudio) f.push(`[${i}:a:0]${norm},volume=${num(s.clip.volume ?? 1)},apad=whole_dur=${d},atrim=duration=${d},asetpts=PTS-STARTPTS[a${k}]`);
      else f.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d}[a${k}]`);
    } else {
      f.push(`color=c=black:s=${PW}x${PH}:r=${FPS}:d=${d},format=yuv420p,setsar=1[v${k}]`);
      f.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d}[a${k}]`);
    }
  });
  f.push(`${segs.map((_, k) => `[v${k}][a${k}]`).join("")}concat=n=${segs.length}:v=1:a=1[prog][pa]`);

  // 2b. Music track.
  const music: string[] = [];
  mclips.forEach((c, j) => {
    const m = media.get(c.mediaId);
    if (!m || !m.hasAudio) return;
    const i = openInput(m, c);
    const ms = Math.round(c.start * 1000);
    f.push(`[${i}:a:0]${norm},volume=${num(c.volume ?? 1)},asetpts=PTS-STARTPTS,adelay=delays=${ms}:all=1[m${j}]`);
    music.push(`[m${j}]`);
  });
  if (music.length) f.push(`[pa]${music.join("")}amix=inputs=${music.length + 1}:duration=first:normalize=0[aout]`);
  else f.push(`[pa]anull[aout]`);

  // 3. Scene composition.
  const layers = scene.layers.filter(l => l.visible && l.w >= 1 && l.h >= 1);
  f.push(`color=c=${hex(scene.background)}:s=${SW}x${SH}:r=${FPS}:d=${num(total)},format=yuv420p[bg0]`);
  if (!layers.length) f.push(`[prog]nullsink`);
  else if (layers.length === 1) f.push(`[prog]null[p0]`);
  else f.push(`[prog]split=${layers.length}${layers.map((_, k) => `[p${k}]`).join("")}`);
  layers.forEach((l, k) => {
    const c = cropRect(l, PW, PH);
    f.push(`[p${k}]crop=${Math.round(c.w)}:${Math.round(c.h)}:${Math.round(c.x)}:${Math.round(c.y)},scale=${Math.max(1, Math.round(l.w))}:${Math.max(1, Math.round(l.h))}:flags=lanczos,setsar=1[l${k}]`);
    f.push(`[bg${k}][l${k}]overlay=x=${Math.round(l.x)}:y=${Math.round(l.y)}:shortest=1[bg${k + 1}]`);
  });
  f.push(`[bg${layers.length}]format=yuv420p[vout]`);

  const video = enc === "nvenc"
    ? ["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", String(quality), "-b:v", "0", "-maxrate", "60M", "-bufsize", "120M", "-profile:v", "high"]
    : ["-c:v", "libx264", "-preset", "medium", "-crf", String(quality - 1), "-profile:v", "high"];
  const output = ["-map", "[vout]", "-map", "[aout]", ...video, "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", num(total),
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
