import { create } from "zustand";
import type { Project } from "./model/types";
import { newProject } from "./model/defaults";

export type PreviewMode = "layout" | "multiview";
export type Dialog = null | "transform" | "export" | "settings";

interface State {
  project: Project;
  path: string | null;
  dirty: boolean;
  past: string[];
  future: string[];
  time: number;
  playing: boolean;
  layoutId: string;
  trackId: string | null;   // target track for adding media
  layerId: string | null;
  clipId: string | null;
  mode: PreviewMode;
  pps: number;              // timeline zoom: pixels per second
  dialog: Dialog;
  proxyProgress: Record<string, number>;   // mediaId -> 0..1 while a preview copy is made
  toast: string | null;
}

interface Actions {
  set: (p: Partial<State>) => void;
  /** Change the project and record one undo step. */
  commit: (fn: (p: Project) => void) => void;
  /** Start a drag: the next live() calls become one undo step. */
  begin: () => void;
  live: (fn: (p: Project) => void) => void;
  end: () => void;
  undo: () => void;
  redo: () => void;
  load: (p: Project, path: string | null) => void;
  notify: (msg: string) => void;
}

let dragBase: string | null = null;
let toastTimer: number | undefined;

export const useStore = create<State & Actions>((set, get) => ({
  project: newProject(),
  path: null, dirty: false, past: [], future: [],
  time: 0, playing: false,
  layoutId: "", trackId: null, layerId: null, clipId: null,
  mode: "layout", pps: 40, dialog: null, proxyProgress: {}, toast: null,

  set: p => set(p),
  commit: fn => {
    const { project, past } = get();
    const before = JSON.stringify(project);
    const next: Project = JSON.parse(before);
    fn(next);
    if (JSON.stringify(next) === before) return;
    set({ project: next, past: [...past.slice(-150), before], future: [], dirty: true });
  },
  begin: () => { dragBase = JSON.stringify(get().project); },
  live: fn => {
    const next: Project = JSON.parse(JSON.stringify(get().project));
    fn(next);
    set({ project: next });
  },
  end: () => {
    if (dragBase == null) return;
    const base = dragBase; dragBase = null;
    if (base === JSON.stringify(get().project)) return;
    set({ past: [...get().past.slice(-150), base], future: [], dirty: true });
  },
  undo: () => {
    const { past, future, project } = get();
    if (!past.length) return;
    set({ project: JSON.parse(past[past.length - 1]), past: past.slice(0, -1), future: [...future, JSON.stringify(project)], dirty: true });
  },
  redo: () => {
    const { past, future, project } = get();
    if (!future.length) return;
    set({ project: JSON.parse(future[future.length - 1]), future: future.slice(0, -1), past: [...past, JSON.stringify(project)], dirty: true });
  },
  load: (p, path) => set({ project: p, path, dirty: false, past: [], future: [], time: 0,
    layoutId: p.layouts[0]?.id ?? "", trackId: null, layerId: null, clipId: null }),
  notify: msg => {
    set({ toast: msg });
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => set({ toast: null }), 4000);
  },
}));

export const S = () => useStore.getState();
export const currentLayout = () => {
  const s = S(); return s.project.layouts.find(x => x.id === s.layoutId) ?? s.project.layouts[0];
};
