// Runs the bundled FFmpeg and ffprobe (Tauri sidecars) and reports progress.
import { Command, type Child } from "@tauri-apps/plugin-shell";
import { writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { appLocalDataDir, join, tempDir } from "@tauri-apps/api/path";
import type { Media, Project, Scene } from "../model/types";
import { buildRenderJob, proxyArgs, type Encoder } from "./graph";
import { fileName, uid } from "../util";

export interface RunHandle { cancel: () => Promise<void>; done: Promise<{ code: number | null; log: string }> }

/** Spawn FFmpeg; onTime gets the output position in seconds from -progress. */
export function runFfmpeg(args: string[], onTime?: (s: number) => void): RunHandle {
  const cmd = Command.sidecar("binaries/ffmpeg", args);
  let child: Child | null = null, log = "";
  cmd.stdout.on("data", (line: string) => {
    const m = /out_time_us=(\d+)/.exec(line);
    if (m && onTime) onTime(+m[1] / 1e6);
  });
  cmd.stderr.on("data", (line: string) => { log = (log + line + "\n").slice(-6000); });
  const done = new Promise<{ code: number | null; log: string }>((resolve, reject) => {
    cmd.on("close", d => resolve({ code: d.code, log }));
    cmd.on("error", e => reject(new Error(String(e))));
  });
  const started = cmd.spawn().then(c => { child = c; });
  return {
    done,
    cancel: async () => { await started; await child?.kill(); },
  };
}

const nvencFailure = (log: string) => /nvenc|cuda|No NVENC capable|Cannot load nvcuda|OpenEncodeSessionEx/i.test(log);

let encoderGuess: Encoder = "nvenc";

/** Read duration, size, frame rate and streams of a file. */
export async function probe(path: string): Promise<Media> {
  const out = await Command.sidecar("binaries/ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]).execute();
  if (out.code !== 0) throw new Error(out.stderr || "ffprobe failed");
  const j = JSON.parse(out.stdout);
  const streams: any[] = j.streams || [];
  const isImage = /\.(png|jpe?g|webp|bmp)$/i.test(path);
  const v = streams.find(s => s.codec_type === "video" && !(s.disposition && s.disposition.attached_pic));
  const a = streams.find(s => s.codec_type === "audio");
  const rate = (v?.avg_frame_rate || v?.r_frame_rate || "0/1").split("/").map(Number);
  const fps = rate[1] ? rate[0] / rate[1] : 0;
  const duration = isImage ? 5 : (+j.format?.duration || +v?.duration || +a?.duration || 0);
  return {
    id: uid(), path, name: fileName(path),
    kind: isImage ? "image" : v ? "video" : "audio",
    duration, width: v?.width || 0, height: v?.height || 0, fps: Math.round(fps * 100) / 100,
    hasVideo: !!v, hasAudio: !!a,
  };
}

/** Make a 720p H.264 copy for playback when the WebView can't play the original. */
export async function makeProxy(m: Media, onProgress: (p: number) => void): Promise<string> {
  const dir = await join(await appLocalDataDir(), "proxies");
  await mkdir(dir, { recursive: true }).catch(() => {});
  const out = await join(dir, `${m.id}.mp4`);
  for (const enc of [encoderGuess, "x264"] as Encoder[]) {
    const r = await runFfmpeg(proxyArgs(m.path, out, enc), s => onProgress(Math.min(1, s / Math.max(1, m.duration)))).done;
    if (r.code === 0) return out;
    if (enc === "nvenc" && nvencFailure(r.log)) { encoderGuess = "x264"; continue; }
    throw new Error(r.log.split("\n").filter(Boolean).slice(-3).join(" "));
  }
  throw new Error("Could not make a preview copy.");
}

export interface ExportResult { scene: Scene; path: string; encoder: Encoder; error?: string }

/** Render one scene. Tries the NVIDIA encoder first and falls back to x264. */
export async function exportScene(p: Project, scene: Scene, outPath: string, quality: number,
  onProgress: (fraction: number) => void, setCancel: (fn: () => Promise<void>) => void): Promise<ExportResult> {
  const script = await join(await tempDir(), `omnicanvas-${uid()}.txt`);
  for (const enc of [encoderGuess, "x264"] as Encoder[]) {
    const job = buildRenderJob(p, scene, outPath, enc, quality);
    await writeTextFile(script, job.filter);
    const args = ["-hide_banner", ...job.inputs, "-/filter_complex", script, ...job.output];
    const h = runFfmpeg(args, s => onProgress(Math.min(1, s / job.duration)));
    setCancel(h.cancel);
    const r = await h.done;
    if (r.code === 0) return { scene, path: outPath, encoder: enc };
    if (enc === "nvenc" && nvencFailure(r.log)) { encoderGuess = "x264"; continue; }
    return { scene, path: outPath, encoder: enc, error: r.log.split("\n").filter(Boolean).slice(-4).join("\n") };
  }
  return { scene, path: outPath, encoder: "x264", error: "Export failed." };
}
