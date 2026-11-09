// The project file is the whole edit as data. The editor, the exporter and
// (later) the MCP server all read and write this one shape.

export type MediaKind = "video" | "audio" | "image";

export interface Media {
  id: string;
  path: string;            // original file, used for export
  proxyPath?: string;      // preview copy, used only for playback in the editor
  name: string;
  kind: MediaKind;
  duration: number;        // seconds
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

export type TrackId = "video" | "music";

export interface Clip {
  id: string;
  mediaId: string;
  track: TrackId;
  start: number;           // timeline seconds
  in: number;              // seconds inside the media
  out: number;             // seconds inside the media
  volume: number;          // 1 = unchanged
}

// Crop is in program pixels, measured in from each edge (same as OBS).
export interface Crop { l: number; t: number; r: number; b: number }

// A layer is one placement of the timeline video inside a scene,
// like a scene item in OBS. A scene can hold the same video many times.
export interface Layer {
  id: string;
  name: string;
  source: "program";
  visible: boolean;
  locked: boolean;
  x: number; y: number; w: number; h: number;  // scene pixels
  crop: Crop;
}

// A scene is an output format: a canvas size plus its layers.
// layers[0] is drawn first (back); the last layer is in front.
export interface Scene {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  layers: Layer[];
}

export interface Project {
  version: 1;
  name: string;
  width: number;    // program size: every clip is fitted into this frame
  height: number;
  fps: number;
  media: Media[];
  clips: Clip[];
  scenes: Scene[];
}
