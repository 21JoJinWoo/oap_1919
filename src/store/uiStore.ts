import { create } from 'zustand';
import type { TrackerStatus } from '../tracking/faceTracker';

export interface RenderStats {
  fps: number;
  calls: number;
  triangles: number;
  textures: number;
  geometries: number;
}

export type Panel = 'layers' | 'add' | 'history' | 'settings' | null;

interface UiState {
  tracker: TrackerStatus;
  trackerMessage: string | null;
  /** User chose mouse control instead of the camera. */
  mouseMode: boolean;
  stats: RenderStats;
  panel: Panel;
  toast: { text: string; kind: 'info' | 'error' } | null;
  busy: string | null;
  recording: boolean;
  /**
   * Exhibition ("사용자 모드"): only the head-tracked space is shown, no UI or cursor.
   * Starts on with `?mode=user` in the URL; Esc returns to EDIT.
   */
  exhibit: boolean;
  set(patch: Partial<Omit<UiState, 'set' | 'notify'>>): void;
  notify(text: string, kind?: 'info' | 'error'): void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useUi = create<UiState>((set) => ({
  tracker: 'idle',
  trackerMessage: null,
  mouseMode: false,
  stats: { fps: 0, calls: 0, triangles: 0, textures: 0, geometries: 0 },
  panel: null,
  toast: null,
  busy: null,
  recording: false,
  exhibit: typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'user',
  set: (patch) => set(patch),
  notify(text, kind = 'info') {
    clearTimeout(toastTimer);
    set({ toast: { text, kind } });
    toastTimer = setTimeout(() => set({ toast: null }), kind === 'error' ? 6000 : 3000);
  },
}));
