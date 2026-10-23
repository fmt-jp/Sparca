import { useSyncExternalStore } from 'react';
import { imageCache } from '../render/imageCache';
import { EditorStore, FEATHER_LIMITS, GRID_SIZE_LIMITS, type EditorState, type GridSettings, type SelectionEdge } from '../store/editor';

export const editor = new EditorStore();

// Grid settings are a per-browser view preference.
const GRID_KEY = 'sparca.grid';
try {
  const saved = JSON.parse(localStorage.getItem(GRID_KEY) ?? 'null') as Partial<GridSettings> | null;
  if (saved && typeof saved === 'object') editor.setGrid(sanitizeGrid(saved));
} catch {
  // Storage unavailable or corrupt: defaults apply.
}
let lastGrid = editor.getState().grid;
editor.subscribe(() => {
  const g = editor.getState().grid;
  if (g === lastGrid) return;
  lastGrid = g;
  try {
    localStorage.setItem(GRID_KEY, JSON.stringify(g));
  } catch {
    // Not remembered; harmless.
  }
});

function sanitizeGrid(g: Partial<GridSettings>): Partial<GridSettings> {
  const out: Partial<GridSettings> = {};
  if (typeof g.visible === 'boolean') out.visible = g.visible;
  if (typeof g.snap === 'boolean') out.snap = g.snap;
  if (typeof g.color === 'string' && /^#[0-9a-f]{6}$/i.test(g.color)) out.color = g.color;
  if (typeof g.size === 'number' && g.size >= GRID_SIZE_LIMITS[0] && g.size <= GRID_SIZE_LIMITS[1]) out.size = g.size;
  return out;
}
// The selection tools' edge setting is a per-browser preference too.
const EDGE_KEY = 'sparca.selectionEdge';
try {
  const saved = JSON.parse(localStorage.getItem(EDGE_KEY) ?? 'null') as Partial<SelectionEdge> | null;
  if (saved && typeof saved === 'object') editor.setSelectionEdge(sanitizeEdge(saved));
} catch {
  // Storage unavailable or corrupt: defaults apply.
}
let lastEdge = editor.getState().selectionEdge;
editor.subscribe(() => {
  const e = editor.getState().selectionEdge;
  if (e === lastEdge) return;
  lastEdge = e;
  try {
    localStorage.setItem(EDGE_KEY, JSON.stringify(e));
  } catch {
    // Not remembered; harmless.
  }
});

function sanitizeEdge(e: Partial<SelectionEdge>): Partial<SelectionEdge> {
  const out: Partial<SelectionEdge> = {};
  if (e.mode === 'hard' || e.mode === 'antialias' || e.mode === 'feather') out.mode = e.mode;
  if (typeof e.feather === 'number' && e.feather >= FEATHER_LIMITS[0] && e.feather <= FEATHER_LIMITS[1]) out.feather = e.feather;
  return out;
}

imageCache.onError((message) => editor.notify('error', message));

{
  // Exposed for debugging and end-to-end tests.
  const g = globalThis as unknown as { __sparca: EditorStore; __sparcaImages: typeof imageCache };
  g.__sparca = editor;
  g.__sparcaImages = imageCache;
}

export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(editor.subscribe, () => selector(editor.getState()));
}
