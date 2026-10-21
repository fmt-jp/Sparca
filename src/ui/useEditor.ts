import { useSyncExternalStore } from 'react';
import { imageCache } from '../render/imageCache';
import { EditorStore, GRID_SIZE_LIMITS, type EditorState, type GridSettings } from '../store/editor';

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
