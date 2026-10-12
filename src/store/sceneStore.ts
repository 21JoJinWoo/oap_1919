import { create } from 'zustand';
import type { SceneDoc, SceneLight, SceneObject, SceneSettings } from '../types';

export type Mode = 'spatial' | 'edit';
export type TransformMode = 'translate' | 'rotate' | 'scale';
export type Selection = { type: 'object' | 'light'; id: string } | null;

interface HistoryEntry {
  doc: SceneDoc;
  label: string;
}

const HISTORY_LIMIT = 100;
/** Edits with the same key inside this window collapse into one undo step. */
const COALESCE_MS = 800;

interface SceneState {
  doc: SceneDoc | null;
  /** `updatedAt` of the copy last loaded from / saved to the server. */
  savedAt: string | null;
  dirty: boolean;
  readOnly: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastKey: string | null;
  lastKeyAt: number;

  mode: Mode;
  transformMode: TransformMode;
  selection: Selection;

  load(doc: SceneDoc, opts: { readOnly: boolean; savedAt: string | null; dirty?: boolean }): void;
  mutate(label: string, fn: (doc: SceneDoc) => void, coalesceKey?: string): void;
  markSaved(updatedAt: string): void;
  undo(): void;
  redo(): void;
  jumpTo(pastIndex: number): void;

  setMode(m: Mode): void;
  setTransformMode(m: TransformMode): void;
  select(s: Selection): void;

  updateObject(id: string, patch: Partial<SceneObject>, coalesceKey?: string): void;
  addObject(obj: SceneObject): void;
  removeSelected(): void;
  duplicateSelected(): void;
  updateLight(id: string, patch: Partial<SceneLight>, coalesceKey?: string): void;
  addLight(light: SceneLight): void;
  updateSettings(fn: (s: SceneSettings) => void, label: string, coalesceKey?: string): void;
}

export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const useScene = create<SceneState>((set, get) => ({
  doc: null,
  savedAt: null,
  dirty: false,
  readOnly: false,
  past: [],
  future: [],
  lastKey: null,
  lastKeyAt: 0,

  mode: 'spatial',
  transformMode: 'translate',
  selection: null,

  load(doc, { readOnly, savedAt, dirty = false }) {
    set({ doc, readOnly, savedAt, dirty, past: [], future: [], lastKey: null, selection: null });
  },

  mutate(label, fn, coalesceKey) {
    const { doc, past, lastKey, lastKeyAt } = get();
    if (!doc) return;
    const next = structuredClone(doc);
    fn(next);
    const now = performance.now();
    const coalesce = coalesceKey !== undefined && coalesceKey === lastKey && now - lastKeyAt < COALESCE_MS;
    set({
      doc: next,
      dirty: true,
      future: [],
      past: coalesce ? past : [...past, { doc, label }].slice(-HISTORY_LIMIT),
      lastKey: coalesceKey ?? null,
      lastKeyAt: now,
    });
  },

  markSaved(updatedAt) {
    const { doc } = get();
    if (doc) set({ doc: { ...doc, updatedAt }, savedAt: updatedAt, dirty: false });
  },

  undo() {
    const { past, future, doc } = get();
    const prev = past[past.length - 1];
    if (!prev || !doc) return;
    set({
      doc: prev.doc,
      past: past.slice(0, -1),
      future: [{ doc, label: prev.label }, ...future],
      dirty: true,
      lastKey: null,
    });
  },

  redo() {
    const { past, future, doc } = get();
    const next = future[0];
    if (!next || !doc) return;
    set({
      doc: next.doc,
      past: [...past, { doc, label: next.label }],
      future: future.slice(1),
      dirty: true,
      lastKey: null,
    });
  },

  jumpTo(pastIndex) {
    // Undo repeatedly until `past` has `pastIndex` entries.
    while (get().past.length > pastIndex) get().undo();
  },

  setMode(mode) {
    set({ mode });
  },
  setTransformMode(transformMode) {
    set({ transformMode });
  },
  select(selection) {
    set({ selection });
  },

  updateObject(id, patch, coalesceKey) {
    get().mutate(
      '오브젝트 수정',
      (d) => {
        const o = d.objects.find((x) => x.id === id);
        if (o) Object.assign(o, patch);
      },
      coalesceKey,
    );
  },

  addObject(obj) {
    get().mutate(`추가: ${obj.name}`, (d) => {
      d.objects.push(obj);
    });
    set({ selection: { type: 'object', id: obj.id } });
  },

  removeSelected() {
    const { selection } = get();
    if (!selection) return;
    get().mutate('삭제', (d) => {
      if (selection.type === 'object') d.objects = d.objects.filter((o) => o.id !== selection.id);
      else d.lights = d.lights.filter((l) => l.id !== selection.id);
    });
    set({ selection: null });
  },

  duplicateSelected() {
    const { selection, doc } = get();
    if (!selection || !doc) return;
    if (selection.type === 'object') {
      const src = doc.objects.find((o) => o.id === selection.id);
      if (!src) return;
      const copy: SceneObject = {
        ...structuredClone(src),
        id: newId('obj'),
        position: [src.position[0] + 1, src.position[1], src.position[2]],
      };
      get().addObject(copy);
    } else {
      const src = doc.lights.find((l) => l.id === selection.id);
      if (!src) return;
      get().addLight({ ...structuredClone(src), id: newId('light') });
    }
  },

  updateLight(id, patch, coalesceKey) {
    get().mutate(
      '조명 수정',
      (d) => {
        const l = d.lights.find((x) => x.id === id);
        if (l) Object.assign(l, patch);
      },
      coalesceKey,
    );
  },

  addLight(light) {
    get().mutate(`추가: ${light.name}`, (d) => {
      d.lights.push(light);
    });
    set({ selection: { type: 'light', id: light.id } });
  },

  updateSettings(fn, label, coalesceKey) {
    get().mutate(label, (d) => fn(d.settings), coalesceKey);
  },
}));

export function selectedObject(s: SceneState): SceneObject | undefined {
  return s.selection?.type === 'object' ? s.doc?.objects.find((o) => o.id === s.selection!.id) : undefined;
}

export function selectedLight(s: SceneState): SceneLight | undefined {
  return s.selection?.type === 'light' ? s.doc?.lights.find((l) => l.id === s.selection!.id) : undefined;
}
