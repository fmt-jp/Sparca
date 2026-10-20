// High-level editor actions invoked by menus, shortcuts and tools.
import {
  addLayer,
  addObject,
  duplicateObjects,
  groupObjects,
  pasteObjects,
  removeObjects,
  reorderObjects,
  transformObjects,
  ungroupObjects,
  type ZOrderOp,
} from '../model/commands';
import { createDocument, createImage } from '../model/factory';
import { IDENTITY_TRANSFORM, unionBounds } from '../model/geometry';
import { findObject, isEffectivelyLocked } from '../model/tree';
import type { Background, SceneObject } from '../model/types';
import { isAbort, pickFiles, saveBlob, type FileSystemFileHandleLike } from '../io/files';
import { PROJECT_EXTENSION, PROJECT_MIME, ProjectError, readProject, writeProject } from '../io/project';
import { assets, ImageLoadError, importImageFile, validateDimensions } from './assets';
import type { EditorStore } from './editor';

let projectHandle: FileSystemFileHandleLike | null = null;
let clipboard: SceneObject[] = [];
let pasteCount = 0;

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif';

export function newDocument(ed: EditorStore, width: number, height: number, background: Background): boolean {
  const problem = validateDimensions(width, height);
  if (problem) {
    ed.notify('error', problem);
    return false;
  }
  const doc = { ...createDocument(Math.round(width), Math.round(height)), background };
  assets.clear();
  projectHandle = null;
  ed.loadDocument(doc, UNTITLED);
  return true;
}

/** Place image files as new image objects, centered on the canvas (scaled down to fit). */
export async function placeImageFiles(ed: EditorStore, files: File[]): Promise<void> {
  const placed: string[] = [];
  for (const file of files) {
    try {
      ed.set({ busy: `「${file.name}」を読み込み中…` });
      const meta = await importImageFile(file, file.name);
      const { doc, activeLayerId } = ed.getState();
      const scale = Math.min(1, doc.width / meta.width, doc.height / meta.height);
      const w = meta.width * scale;
      const h = meta.height * scale;
      const offset = placed.length * 20;
      const img = createImage(meta, {
        x: Math.round((doc.width - w) / 2) + offset,
        y: Math.round((doc.height - h) / 2) + offset,
        width: w,
        height: h,
        rotation: 0,
      });
      const layerId = writableLayer(ed, activeLayerId);
      if (!layerId) return;
      ed.edit('画像を配置', (d) => {
        d.assets[meta.id] = meta;
        addObject(d, layerId, img);
      });
      placed.push(img.id);
    } catch (e) {
      ed.notify('error', e instanceof ImageLoadError ? e.message : `「${file.name}」の読み込みに失敗しました: ${String(e)}`);
    } finally {
      ed.set({ busy: null });
    }
  }
  if (placed.length) {
    ed.select(placed);
    ed.setTool('select');
  }
}

export async function chooseAndPlaceImage(ed: EditorStore): Promise<void> {
  const files = await pickFiles(IMAGE_ACCEPT, true);
  if (files.length) await placeImageFiles(ed, files);
}

/** Returns an unlocked, visible layer to draw into, notifying the user when there is none. */
export function writableLayer(ed: EditorStore, preferredId: string): string | null {
  const { doc } = ed.getState();
  const layer = doc.layers.find((l) => l.id === preferredId);
  if (layer && !layer.locked) return layer.id;
  if (layer?.locked) {
    ed.notify('error', `レイヤー「${layer.name}」はロックされています。ロックを解除するか、別のレイヤーを選んでください。`);
    return null;
  }
  return doc.layers[doc.layers.length - 1]?.id ?? null;
}

// ---- Project save / open ----

export const UNTITLED = '名称未設定';

/** File name suggested when saving. Untitled documents get an ASCII name, which every browser keeps. */
function projectName(fileName: string): string {
  const base = fileName === UNTITLED ? 'untitled' : fileName;
  return base.endsWith(PROJECT_EXTENSION) ? base : `${base}${PROJECT_EXTENSION}`;
}

export async function saveProject(ed: EditorStore, saveAs = false): Promise<boolean> {
  const { doc, fileName } = ed.getState();
  try {
    ed.set({ busy: '保存中…' });
    const data = await writeProject(doc, (id) => assets.get(id)?.blob);
    const blob = new Blob([data as BlobPart], { type: PROJECT_MIME });
    const handle = await saveBlob(
      blob,
      projectName(fileName),
      { description: 'Sparca プロジェクト', accept: { [PROJECT_MIME]: [PROJECT_EXTENSION] } },
      saveAs ? null : projectHandle,
    );
    if (handle === undefined) return false;
    projectHandle = handle;
    ed.markSaved(handle ? handle.name : projectName(fileName));
    ed.notify('info', '保存しました。');
    return true;
  } catch (e) {
    ed.notify('error', e instanceof ProjectError ? e.message : `保存に失敗しました: ${describeError(e)}`);
    return false;
  } finally {
    ed.set({ busy: null });
  }
}

export async function openProjectFile(ed: EditorStore, file: File): Promise<void> {
  try {
    ed.set({ busy: '読み込み中…' });
    const { doc, assets: blobs } = await readProject(await file.arrayBuffer());
    assets.clear();
    for (const [id, blob] of blobs) assets.put(doc.assets[id], blob);
    projectHandle = null;
    ed.loadDocument(doc, file.name);
  } catch (e) {
    ed.notify('error', e instanceof ProjectError ? e.message : `「${file.name}」を開けませんでした: ${describeError(e)}`);
  } finally {
    ed.set({ busy: null });
  }
}

export async function chooseAndOpenProject(ed: EditorStore): Promise<void> {
  const [file] = await pickFiles(`${PROJECT_EXTENSION},${PROJECT_MIME}`);
  if (file) await openProjectFile(ed, file);
}

export function describeError(e: unknown): string {
  if (isAbort(e)) return '操作がキャンセルされました';
  if (e instanceof Error) return e.message;
  return String(e);
}

// ---- Object operations on the selection ----

function editableSelection(ed: EditorStore): string[] {
  const { doc, selection } = ed.getState();
  return selection.filter((id) => {
    const loc = findObject(doc, id);
    return loc && !isEffectivelyLocked(loc);
  });
}

export function deleteSelection(ed: EditorStore): void {
  const ids = editableSelection(ed);
  if (!ids.length) return;
  ed.edit('削除', (d) => removeObjects(d, ids));
  ed.select([]);
}

export function duplicateSelection(ed: EditorStore): void {
  const ids = editableSelection(ed);
  if (!ids.length) return;
  let newIds: string[] = [];
  ed.edit('複製', (d) => {
    newIds = duplicateObjects(d, ids);
  });
  ed.select(newIds);
}

export function copySelection(ed: EditorStore): void {
  const { doc, selection } = ed.getState();
  clipboard = selection.map((id) => findObject(doc, id)?.object).filter((o): o is SceneObject => !!o);
  pasteCount = 0;
}

export function cutSelection(ed: EditorStore): void {
  copySelection(ed);
  deleteSelection(ed);
}

export function paste(ed: EditorStore): void {
  if (!clipboard.length) return;
  const layerId = writableLayer(ed, ed.getState().activeLayerId);
  if (!layerId) return;
  pasteCount += 1;
  let ids: string[] = [];
  const objs = clipboard;
  const offset = pasteCount * 10;
  ed.edit('ペースト', (d) => {
    ids = pasteObjects(d, layerId, objs, offset, offset);
  });
  ed.select(ids);
}

export function hasClipboard(): boolean {
  return clipboard.length > 0;
}

export function nudgeSelection(ed: EditorStore, dx: number, dy: number): void {
  const ids = editableSelection(ed);
  if (!ids.length) return;
  ed.edit('移動', (d) => transformObjects(d, ids, { ...IDENTITY_TRANSFORM, dx, dy }), `nudge:${ids.join(',')}`);
}

export function arrangeSelection(ed: EditorStore, op: ZOrderOp): void {
  const ids = editableSelection(ed);
  if (!ids.length) return;
  ed.edit('重ね順の変更', (d) => reorderObjects(d, ids, op));
}

export function groupSelection(ed: EditorStore): void {
  const ids = editableSelection(ed);
  if (ids.length < 2) return;
  let gid: string | null = null;
  ed.edit('グループ化', (d) => {
    gid = groupObjects(d, ids);
  });
  if (gid) ed.select([gid]);
  else ed.notify('error', 'グループ化できるのは同じレイヤー・同じ階層のオブジェクトだけです。');
}

export function ungroupSelection(ed: EditorStore): void {
  const ids = editableSelection(ed);
  let released: string[] = [];
  ed.edit('グループ解除', (d) => {
    released = ungroupObjects(d, ids);
  });
  if (released.length) ed.select(released);
}

export type AlignOp = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Align selected objects to their common bounds (or to the canvas for a single object). */
export function alignSelection(ed: EditorStore, op: AlignOp): void {
  const { doc } = ed.getState();
  const ids = editableSelection(ed);
  const objs = ids.map((id) => findObject(doc, id)!.object);
  if (!objs.length) return;
  const target = objs.length === 1 ? { x: 0, y: 0, width: doc.width, height: doc.height } : unionBounds(objs)!;
  ed.edit('整列', (d) => {
    for (const o of objs) {
      const b = unionBounds([o]);
      if (!b) continue;
      let dx = 0;
      let dy = 0;
      if (op === 'left') dx = target.x - b.x;
      if (op === 'hcenter') dx = target.x + target.width / 2 - (b.x + b.width / 2);
      if (op === 'right') dx = target.x + target.width - (b.x + b.width);
      if (op === 'top') dy = target.y - b.y;
      if (op === 'vcenter') dy = target.y + target.height / 2 - (b.y + b.height / 2);
      if (op === 'bottom') dy = target.y + target.height - (b.y + b.height);
      transformObjects(d, [o.id], { ...IDENTITY_TRANSFORM, dx, dy });
    }
  });
}

export function selectAll(ed: EditorStore): void {
  const { doc, activeLayerId } = ed.getState();
  const layer = doc.layers.find((l) => l.id === activeLayerId);
  if (!layer || !layer.visible) return;
  ed.select(layer.children.filter((o) => o.visible && !o.locked).map((o) => o.id));
}

export function newLayer(ed: EditorStore): void {
  let id = '';
  ed.edit('レイヤーの追加', (d) => {
    id = addLayer(d, ed.getState().activeLayerId).id;
  });
  ed.set({ activeLayerId: id });
}
