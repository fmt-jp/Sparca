import { produce, type Draft } from 'immer';
import { emptyHistory, record, redo as historyRedo, undo as historyUndo, type HistoryState } from '../history/history';
import { createDocument } from '../model/factory';
import type { Id, Point, SparcaDocument } from '../model/types';

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

/** Pixel (area) selection, kept in document coordinates. Distinct from object selection. */
export type PixelSelection =
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'ellipse'; x: number; y: number; width: number; height: number }
  | { kind: 'polygon'; points: Point[] };

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

export interface EditorState {
  doc: SparcaDocument;
  history: HistoryState<SparcaDocument>;
  /** Document as last saved; dirty = doc !== savedDoc. */
  savedDoc: SparcaDocument;
  fileName: string;
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
  /** Last color picked with the eyedropper. */
  pickedColor: string | null;
  zoom: number;
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

  constructor(doc: SparcaDocument = createDocument()) {
    this.state = {
      doc,
      history: emptyHistory(),
      savedDoc: doc,
      fileName: '名称未設定',
      selection: [],
      nodeSelection: [],
      activeLayerId: doc.layers[doc.layers.length - 1].id,
      tool: 'select',
      pixelSelection: null,
      crop: null,
      compareImageId: null,
      eyedropperTarget: 'fill',
      pickedColor: null,
      zoom: 1,
      notices: [],
      busy: null,
    };
  }

  getState = (): EditorState => this.state;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  set(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  get dirty(): boolean {
    return this.state.doc !== this.state.savedDoc;
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

  /** Replace the whole document (new / open). Clears history. */
  loadDocument(doc: SparcaDocument, fileName: string): void {
    this.set({
      doc,
      savedDoc: doc,
      history: emptyHistory(),
      fileName,
      selection: [],
      nodeSelection: [],
      pixelSelection: null,
      crop: null,
      compareImageId: null,
      activeLayerId: doc.layers[doc.layers.length - 1]?.id ?? '',
    });
  }

  markSaved(fileName?: string): void {
    this.set({ savedDoc: this.state.doc, fileName: fileName ?? this.state.fileName });
  }

  select(ids: Id[]): void {
    const same = ids.length === this.state.selection.length && ids.every((id, i) => id === this.state.selection[i]);
    this.set(same ? { selection: ids } : { selection: ids, nodeSelection: [] });
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
