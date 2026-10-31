import { produce, type Draft } from 'immer';
import { emptyHistory, record, redo as historyRedo, undo as historyUndo, type HistoryState } from '../history/history';
import { createDocument } from '../model/factory';
import type { FileSystemFileHandleLike } from '../io/files';
import { newId } from '../model/factory';
import { DEFAULT_TOOL_DEFAULTS, type ToolCategory, type ToolDefaults } from '../model/toolDefaults';
import type { Id, MaskShape, Point, SparcaDocument } from '../model/types';

export type ToolId =
  | 'select'
  | 'subselect'
  | 'crop'
  | 'marquee-rect'
  | 'marquee-ellipse'
  | 'lasso'
  | 'polygon-lasso'
  | 'eyedropper'
  | 'hand'
  | 'zoom'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'rect'
  | 'rounded-rect'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'text';

/** Pixel (area) selection, kept in document coordinates (edge lengths in document px). Distinct from object selection. */
export type PixelSelection = MaskShape;

/** Edge setting of the selection tools (Fireworks 「エッジ」): applied to new selections. */
export interface SelectionEdge {
  mode: 'hard' | 'antialias' | 'feather';
  /** Feather width in px (mode 'feather'). */
  feather: number;
}

export const DEFAULT_SELECTION_EDGE: SelectionEdge = { mode: 'antialias', feather: 10 };
export const FEATHER_LIMITS = [0, 100] as const;
/** Largest expand / contract amount in px. */
export const GROW_LIMIT = 500;

/** The selection with the edge setting applied (its grow is kept). */
export function withSelectionEdge(sel: PixelSelection, edge: SelectionEdge): PixelSelection {
  const out: PixelSelection = { ...sel };
  delete out.antialias;
  delete out.feather;
  if (edge.mode === 'hard') out.antialias = false;
  else if (edge.mode === 'feather' && edge.feather > 0) out.feather = edge.feather;
  return out;
}

export interface CropState {
  /** 'document' crops the canvas; 'image' crops only the given image object. */
  target: 'document' | 'image';
  imageId: Id | null;
  /** Crop rectangle in document coordinates. */
  rect: { x: number; y: number; width: number; height: number } | null;
}

export interface Notice {
  id: number;
  kind: 'info' | 'error';
  message: string;
}

export const UNTITLED = '名称未設定';

/** Grid shown over the canvas (a view setting, not part of the document). */
export interface GridSettings {
  visible: boolean;
  /** Spacing in document px. */
  size: number;
  color: string;
  snap: boolean;
}

export const DEFAULT_GRID: GridSettings = { visible: false, size: 20, color: '#00a0ff', snap: false };
export const GRID_SIZE_LIMITS = [2, 1000] as const;

/** Round a value to the nearest grid line. */
export function snapValue(v: number, size: number): number {
  return Math.round(v / size) * size;
}

/** A tab as shown in the tab bar. */
export interface TabInfo {
  id: string;
  fileName: string;
  dirty: boolean;
}

/** Fields that belong to one open document (one tab). */
const SESSION_KEYS = [
  'doc',
  'history',
  'savedDoc',
  'fileName',
  'fileHandle',
  'selection',
  'nodeSelection',
  'activeLayerId',
  'pixelSelection',
  'crop',
  'compareImageId',
  'zoom',
] as const;
type SessionKey = (typeof SESSION_KEYS)[number];
type Session = Pick<EditorState, SessionKey>;

export interface EditorState {
  /** Open documents in tab order; the active one's fields are the ones below. */
  tabs: TabInfo[];
  activeTabId: string;
  doc: SparcaDocument;
  history: HistoryState<SparcaDocument>;
  /** Document as last saved; dirty = doc !== savedDoc. */
  savedDoc: SparcaDocument;
  fileName: string;
  /** Where the document was saved (File System Access API), for plain "save". */
  fileHandle: FileSystemFileHandleLike | null;
  selection: Id[];
  /** Selected anchors (indices) of the selected path while editing it with the subselect tool. */
  nodeSelection: number[];
  activeLayerId: Id;
  tool: ToolId;
  pixelSelection: PixelSelection | null;
  crop: CropState | null;
  /** Image object currently shown without its pipeline (before/after comparison). */
  compareImageId: Id | null;
  /** Where the eyedropper applies a picked color on selected shapes. */
  eyedropperTarget: 'fill' | 'stroke';
  /** Whose gradient handles the canvas shows when both fill and stroke are gradients. */
  gradientTarget: 'fill' | 'stroke';
  /** Last color picked with the eyedropper. */
  pickedColor: string | null;
  zoom: number;
  grid: GridSettings;
  /** Align multiple objects to the canvas instead of to each other. */
  alignToCanvas: boolean;
  /** Edge setting of the marquee / lasso tools. */
  selectionEdge: SelectionEdge;
  /** Settings for new objects, per kind of drawing tool. */
  toolDefaults: ToolDefaults;
  notices: Notice[];
  /** Non-null while a long-running task is in progress. */
  busy: string | null;
}

type Listener = () => void;

export class EditorStore {
  private state: EditorState;
  private listeners = new Set<Listener>();
  /** Document snapshot taken at the start of a drag/slider gesture. */
  private gestureStart: SparcaDocument | null = null;
  private noticeSeq = 0;
  /** Sessions of the tabs that are not active. */
  private inactive = new Map<string, Session>();

  constructor(doc: SparcaDocument = createDocument()) {
    const id = newId('t');
    this.state = {
      tabs: [],
      activeTabId: id,
      ...freshSession(doc, UNTITLED, null),
      tool: 'select',
      eyedropperTarget: 'fill',
      gradientTarget: 'fill',
      grid: DEFAULT_GRID,
      selectionEdge: DEFAULT_SELECTION_EDGE,
      toolDefaults: DEFAULT_TOOL_DEFAULTS,
      alignToCanvas: false,
      pickedColor: null,
      notices: [],
      busy: null,
    };
    this.state.tabs = this.computeTabs(this.state, [id]);
  }

  getState = (): EditorState => this.state;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  set(patch: Partial<EditorState>): void {
    const next = { ...this.state, ...patch };
    const prev = this.state;
    if (next.doc !== prev.doc || next.savedDoc !== prev.savedDoc || next.fileName !== prev.fileName) {
      next.tabs = this.computeTabs(next, next.tabs.map((t) => t.id));
    }
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  get dirty(): boolean {
    return this.state.doc !== this.state.savedDoc;
  }

  /** Whether any open document has unsaved changes. */
  get anyDirty(): boolean {
    return this.state.tabs.some((t) => t.dirty);
  }

  private computeTabs(st: EditorState, order: string[]): TabInfo[] {
    return order.map((id) => {
      const s = id === st.activeTabId ? st : this.inactive.get(id)!;
      return { id, fileName: s.fileName, dirty: s.doc !== s.savedDoc };
    });
  }

  private snapshot(): Session {
    const s = {} as Record<SessionKey, unknown>;
    for (const k of SESSION_KEYS) s[k] = this.state[k];
    return s as Session;
  }

  /**
   * Open a document in a new tab and switch to it. An untouched, empty untitled
   * document in the current tab is replaced instead of being kept around.
   */
  openDocument(doc: SparcaDocument, fileName: string, fileHandle: FileSystemFileHandleLike | null = null): void {
    this.gestureStart = null;
    const st = this.state;
    const pristine =
      st.fileName === UNTITLED &&
      st.history.past.length === 0 &&
      st.doc === st.savedDoc &&
      st.doc.layers.every((l) => l.children.length === 0);
    if (pristine) {
      this.loadDocument(doc, fileName, fileHandle);
      return;
    }
    this.inactive.set(st.activeTabId, this.snapshot());
    const id = newId('t');
    const order = [...st.tabs.map((t) => t.id), id];
    const next: EditorState = { ...st, ...freshSession(doc, fileName, fileHandle), activeTabId: id };
    next.tabs = this.computeTabs(next, order);
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  switchTab(id: string): void {
    const target = this.inactive.get(id);
    if (!target || id === this.state.activeTabId) return;
    this.gestureStart = null;
    this.inactive.set(this.state.activeTabId, this.snapshot());
    this.inactive.delete(id);
    const order = this.state.tabs.map((t) => t.id);
    const next: EditorState = { ...this.state, ...target, activeTabId: id };
    next.tabs = this.computeTabs(next, order);
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  /** Close a tab (no confirmation here). The last tab is replaced by a new empty document. */
  closeTab(id: string): void {
    const order = this.state.tabs.map((t) => t.id);
    if (!order.includes(id)) return;
    if (order.length === 1) {
      this.loadDocument(createDocument(), UNTITLED, null);
      return;
    }
    if (id !== this.state.activeTabId) {
      this.inactive.delete(id);
      this.set({ tabs: this.computeTabs(this.state, order.filter((t) => t !== id)) });
      return;
    }
    // Activate the neighbor (right, else left), then drop the closed one.
    const i = order.indexOf(id);
    const neighbor = order[i + 1] ?? order[i - 1];
    this.switchTab(neighbor);
    this.inactive.delete(id);
    this.set({ tabs: this.computeTabs(this.state, order.filter((t) => t !== id)) });
  }

  /** Whether a tab has unsaved changes. */
  isTabDirty(id: string): boolean {
    return this.state.tabs.find((t) => t.id === id)?.dirty ?? false;
  }

  /** Apply an undoable edit to the document. */
  edit(label: string, recipe: (d: Draft<SparcaDocument>) => void, mergeKey: string | null = null): void {
    if (this.gestureStart) {
      this.preview(recipe);
      return;
    }
    const prev = this.state.doc;
    const next = produce(prev, recipe);
    if (next === prev) return;
    this.set({ doc: next, history: record(this.state.history, prev, label, mergeKey) });
    this.fixupSelection();
  }

  /** Start a gesture: edits until endGesture() form a single undo step. */
  beginGesture(): void {
    this.gestureStart = this.state.doc;
  }

  /** Update the document during a gesture without recording history. */
  preview(recipe: (d: Draft<SparcaDocument>) => void): void {
    const next = produce(this.state.doc, recipe);
    if (next !== this.state.doc) this.set({ doc: next });
  }

  endGesture(label: string): void {
    const start = this.gestureStart;
    this.gestureStart = null;
    if (start && start !== this.state.doc) {
      this.set({ history: record(this.state.history, start, label) });
    }
  }

  cancelGesture(): void {
    const start = this.gestureStart;
    this.gestureStart = null;
    if (start) this.set({ doc: start });
  }

  get inGesture(): boolean {
    return this.gestureStart !== null;
  }

  undo(): void {
    const r = historyUndo(this.state.history, this.state.doc);
    if (!r) return;
    this.set({ doc: r.state, history: r.history });
    this.fixupSelection();
  }

  redo(): void {
    const r = historyRedo(this.state.history, this.state.doc);
    if (!r) return;
    this.set({ doc: r.state, history: r.history });
    this.fixupSelection();
  }

  /** Replace the document in the current tab. Clears its history. */
  loadDocument(doc: SparcaDocument, fileName: string, fileHandle: FileSystemFileHandleLike | null = null): void {
    this.gestureStart = null;
    this.set(freshSession(doc, fileName, fileHandle));
  }

  markSaved(fileName?: string, fileHandle?: FileSystemFileHandleLike | null): void {
    this.set({
      savedDoc: this.state.doc,
      fileName: fileName ?? this.state.fileName,
      fileHandle: fileHandle === undefined ? this.state.fileHandle : fileHandle,
    });
  }

  select(ids: Id[]): void {
    const same = ids.length === this.state.selection.length && ids.every((id, i) => id === this.state.selection[i]);
    this.set(same ? { selection: ids } : { selection: ids, nodeSelection: [] });
  }

  /** Change the selection edge setting; the current selection takes it too. */
  setSelectionEdge(patch: Partial<SelectionEdge>): void {
    const selectionEdge = { ...this.state.selectionEdge, ...patch };
    const sel = this.state.pixelSelection;
    this.set({ selectionEdge, pixelSelection: sel && withSelectionEdge(sel, selectionEdge) });
  }

  /** Change the settings new objects of one kind of drawing tool get. */
  setToolDefaults<K extends ToolCategory>(category: K, patch: Partial<ToolDefaults[K]>): void {
    const toolDefaults = { ...this.state.toolDefaults, [category]: { ...this.state.toolDefaults[category], ...patch } };
    this.set({ toolDefaults });
  }

  /** Set a newly drawn pixel selection, with the tools' edge setting. */
  setPixelSelection(sel: PixelSelection | null): void {
    this.set({ pixelSelection: sel && withSelectionEdge(sel, this.state.selectionEdge) });
  }

  setGrid(patch: Partial<GridSettings>): void {
    this.set({ grid: { ...this.state.grid, ...patch } });
  }

  /** Snap a document point to the grid when snapping is on. */
  snap<T extends Point>(p: T): T {
    const g = this.state.grid;
    return g.snap ? { ...p, x: snapValue(p.x, g.size), y: snapValue(p.y, g.size) } : p;
  }

  setTool(tool: ToolId): void {
    if (tool === this.state.tool) return;
    this.set({ tool, crop: tool === 'crop' ? this.state.crop : null });
  }

  notify(kind: Notice['kind'], message: string): void {
    const n = { id: ++this.noticeSeq, kind, message };
    this.set({ notices: [...this.state.notices, n] });
    setTimeout(() => this.dismiss(n.id), kind === 'error' ? 8000 : 3000);
  }

  dismiss(id: number): void {
    this.set({ notices: this.state.notices.filter((n) => n.id !== id) });
  }

  /** Drop selected ids that no longer exist; keep the active layer valid. */
  private fixupSelection(): void {
    const { doc, selection, activeLayerId } = this.state;
    const exists = new Set<string>();
    const collect = (objs: SparcaDocument['layers'][number]['children']) => {
      for (const o of objs) {
        exists.add(o.id);
        if (o.type === 'group') collect(o.children);
      }
    };
    doc.layers.forEach((l) => collect(l.children));
    const sel = selection.filter((id) => exists.has(id));
    const layerOk = doc.layers.some((l) => l.id === activeLayerId);
    if (sel.length !== selection.length || !layerOk) {
      this.set({
        selection: sel,
        activeLayerId: layerOk ? activeLayerId : (doc.layers[doc.layers.length - 1]?.id ?? ''),
      });
    }
  }
}

function freshSession(doc: SparcaDocument, fileName: string, fileHandle: FileSystemFileHandleLike | null): Session {
  return {
    doc,
    history: emptyHistory(),
    savedDoc: doc,
    fileName,
    fileHandle,
    selection: [],
    nodeSelection: [],
    activeLayerId: doc.layers[doc.layers.length - 1]?.id ?? '',
    pixelSelection: null,
    crop: null,
    compareImageId: null,
    zoom: 1,
  };
}
