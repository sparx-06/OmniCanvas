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

export type TrackKind = "video" | "audio";

/** A timeline track. Video tracks also carry the audio of their clips. */
export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
}

export interface Clip {
  id: string;
  mediaId: string;
  track: string;           // Track.id
  start: number;           // timeline seconds
  in: number;              // seconds inside the media
  out: number;             // seconds inside the media
  volume: number;          // 1 = unchanged
}

// Crop is in pixels of the layer's source, measured in from each edge (as in OBS).
// For a track source that is the program size; for a file it is the file's size.
export interface Crop { l: number; t: number; r: number; b: number }

/** What a layer shows: whatever is playing on a video track, or one file for the whole video. */
export type LayerSource =
  | { type: "track"; trackId: string }
  | { type: "media"; mediaId: string };

// A layer is one placement of a source inside a layout, like a source in an OBS scene.
// Several layers can show the same track with different crops.
export interface Layer {
  id: string;
  name: string;
  source: LayerSource;
  visible: boolean;
  locked: boolean;
  x: number; y: number; w: number; h: number;  // layout pixels
  crop: Crop;
}

// A layout is an output format: a canvas size plus its layers.
// layers[0] is drawn first (back); the last layer is in front.
export interface Layout {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  layers: Layer[];
}

export interface Project {
  version: 2;
  name: string;
  width: number;    // program size: every clip on a video track is fitted into this frame
  height: number;
  fps: number;
  media: Media[];
  tracks: Track[];
  clips: Clip[];
  layouts: Layout[];
}
