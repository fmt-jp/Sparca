import { useSyncExternalStore } from 'react';
import { imageCache } from '../render/imageCache';
import { editLineAsPath } from '../store/pathActions';
import { sanitizeToolDefaults } from '../model/toolDefaults';
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

// Rulers on/off is a per-browser view preference as well.
const RULERS_KEY = 'sparca.rulers';
const RULER_ORIGIN_KEY = 'sparca.rulerOrigin';
const SMART_GUIDES_KEY = 'sparca.smartGuides';
const IMAGE_PLACEMENT_KEY = 'sparca.imagePlacement';
try {
  const saved = JSON.parse(localStorage.getItem(RULERS_KEY) ?? 'null') as unknown;
  if (typeof saved === 'boolean') editor.set({ rulers: saved });
  const origin = localStorage.getItem(RULER_ORIGIN_KEY);
  if (origin === 'corner' || origin === 'center') editor.set({ rulerOrigin: origin });
  const guides = JSON.parse(localStorage.getItem(SMART_GUIDES_KEY) ?? 'null') as unknown;
  if (typeof guides === 'boolean') editor.set({ smartGuides: guides });
  const placement = localStorage.getItem(IMAGE_PLACEMENT_KEY);
  if (placement === 'ask' || placement === 'original' || placement === 'fit') editor.set({ imagePlacement: placement });
} catch {
  // Storage unavailable or corrupt: shown, counting from the corner, by default.
}
let lastRulers = editor.getState().rulers;
let lastOrigin = editor.getState().rulerOrigin;
let lastGuides = editor.getState().smartGuides;
let lastPlacement = editor.getState().imagePlacement;
editor.subscribe(() => {
  const { rulers, rulerOrigin, smartGuides, imagePlacement } = editor.getState();
  if (rulers === lastRulers && rulerOrigin === lastOrigin && smartGuides === lastGuides && imagePlacement === lastPlacement) return;
  lastRulers = rulers;
  lastOrigin = rulerOrigin;
  lastGuides = smartGuides;
  lastPlacement = imagePlacement;
  try {
    localStorage.setItem(RULERS_KEY, JSON.stringify(rulers));
    localStorage.setItem(RULER_ORIGIN_KEY, rulerOrigin);
    localStorage.setItem(SMART_GUIDES_KEY, JSON.stringify(smartGuides));
    localStorage.setItem(IMAGE_PLACEMENT_KEY, imagePlacement);
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

// Settings for new objects (per drawing tool) are a per-browser preference too.
const DEFAULTS_KEY = 'sparca.toolDefaults';
try {
  const saved = localStorage.getItem(DEFAULTS_KEY);
  if (saved) editor.set({ toolDefaults: sanitizeToolDefaults(JSON.parse(saved)) });
} catch {
  // Storage unavailable or corrupt: defaults apply.
}
let lastDefaults = editor.getState().toolDefaults;
editor.subscribe(() => {
  const d = editor.getState().toolDefaults;
  if (d === lastDefaults) return;
  lastDefaults = d;
  try {
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d));
  } catch {
    // Not remembered; harmless.
  }
});

// Switching to the subselect tool with an old line shape selected makes it an editable path.
let lastTool = editor.getState().tool;
editor.subscribe(() => {
  const tool = editor.getState().tool;
  if (tool === lastTool) return;
  lastTool = tool;
  if (tool === 'subselect') editLineAsPath(editor);
});

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
