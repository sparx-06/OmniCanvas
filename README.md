# OmniCanvas

A Windows video editor for gaming channels. You edit the video once, and every
format (horizontal for YouTube, vertical for Shorts and TikTok) renders from
that one edit.

- **Sources** are your raw recordings, for example OBS captures.
- **The timeline** is where you cut the full video. It works like Vegas: a
  click anywhere moves the cursor there.
- **Layouts** are output formats (horizontal, vertical, square). A layout holds
  **layers**. Each layer shows a video track, or one file such as a logo, with
  its own crop, position and size, like a source in an OBS scene. A vertical
  layout can show the same track twice: the facecam cropped on top and the
  gameplay cropped below.

## Install

1. Open the repository's **Releases** page.
2. Download the file ending in `-setup.exe` from the newest build.
3. Run it. Windows may say the app is unsigned: choose **More info**, then
   **Run anyway**.

FFmpeg is included. Exports use the NVIDIA encoder when the PC has one and the
CPU encoder otherwise.

## Using it

1. **Import media** and pick your recordings. The first recording sets the
   program size, so crops line up with it.
2. Drag a recording onto a video track, or double-click it to add it at the
   cursor on the selected track. Music and sound go on an audio track. Add
   tracks with **+ Video track** and **+ Audio track**.
3. Cut the video on the timeline.
4. Pick a layout in **Layouts** and set up its layers in the preview. The
   Vertical layout starts with two uncropped copies of Video 1, stacked.
   Alt-drag to crop each one (for example the facecam and the gameplay), then
   drag and resize them into place. OmniCanvas never sets a crop for you.
5. **Export** renders every ticked layout into the folder you choose.

### Timeline (Vegas habits)

| Action | How |
|---|---|
| Move the cursor | Click anywhere on the timeline, including on a clip |
| Play, then stop and go back | Space |
| Play, then pause where you are | Enter |
| Split | S (splits the selected clip, or every clip under the cursor) |
| Move a clip | Drag it, also onto another track of the same kind |
| Select a track | Click its name. Double-click to rename it |
| Trim a clip | Drag its left or right edge |
| Step one frame | Left and Right arrows (Shift: one second) |
| Zoom | Mouse wheel. Shift and wheel scrolls |
| Delete | Delete |
| Undo, redo | Ctrl+Z, Ctrl+Y |

### Layout canvas (OBS habits)

| Action | How |
|---|---|
| Add a layer | **+** in **Layers**: an existing video track, a new video track, or a file |
| Change what a layer shows | Select it, then pick in **Shows** |
| Select a layer | Click it, or click it in **Layers** |
| Move | Drag it. Edges snap to the canvas; hold Ctrl to stop snapping |
| Resize | Drag a red handle. Corners keep the shape; hold Shift to stretch |
| Crop | Hold Alt and drag a handle. Cropped edges turn green |
| Exact numbers | Double-click the layer, or Ctrl+E (Edit Transform) |
| More | Right-click: Fit to Screen, Stretch to Screen, Center, order, lock |

**Multiview** shows every layout side by side. Click one to edit it.

### Files OBS writes

If the preview can't play a recording (for example HEVC or some MKV files),
OmniCanvas makes a 720p preview copy in the background. Export always uses the
original file.

## Project file

A project is saved as a `.omni` file: plain JSON with the media paths, the
tracks, the clips on each track, and the layouts with their layers. Files
saved by the first version are converted when opened. It is the same data a
future MCP server will read and change.

## Development

The app is Tauri 2 (Rust shell) with a React and TypeScript interface. FFmpeg
and ffprobe run as bundled sidecars.

```
npm install
npm run tauri dev
```

`npm run tauri dev` needs `ffmpeg` and `ffprobe` in `src-tauri/binaries/`,
named with the Rust target triple, for example
`ffmpeg-x86_64-pc-windows-msvc.exe`. The GitHub workflow downloads them for
release builds.

| Path | What it holds |
|---|---|
| `src/model/` | Project types, default layouts, file conversion |
| `src/engine/graph.ts` | Builds the FFmpeg filter graph for one layout |
| `src/engine/ffmpeg.ts` | Runs FFmpeg and ffprobe, export and preview copies |
| `src/engine/player.ts` | Preview playback and drawing |
| `src/components/` | Panels: media, layouts, layers, timeline, dialogs |

## Roadmap

1. Audio: volume and fades per clip and track, waveforms, voice clean-up,
   loudness levelling, music that lowers under speech.
2. Local Whisper transcription with word-level captions.
3. Shorts markers: drag across a range to mark a short; each exports through
   a vertical layout with its own extra layers.
4. A general motion tracker: click what to follow, and a layer's crop moves
   with it.
5. AI highlight suggestions (through MCP from ChatGPT or Claude, an API key,
   or a local model).
