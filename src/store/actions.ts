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
import { findObject, isEffectivelyLocked, walkObjects } from '../model/tree';
import type { Background, SceneObject, SparcaDocument } from '../model/types';
import { IMAGE_ACCEPT, stripImageExtension } from '../io/imageFormats';
import { isAbort, pickFiles, saveBlob } from '../io/files';
import { PROJECT_EXTENSION, PROJECT_MIME, ProjectError, readProject, writeProject } from '../io/project';
import { assets, ImageLoadError, importImageFile, validateDimensions } from './assets';
import { UNTITLED, type EditorStore } from './editor';

let clipboard: SceneObject[] = [];
/** Metadata of images referenced by the clipboard, so pasting into another document works. */
let clipboardAssets: SparcaDocument['assets'] = {};
let pasteCount = 0;


export function newDocument(ed: EditorStore, width: number, height: number, background: Background): boolean {
  const problem = validateDimensions(width, height);
  if (problem) {
    ed.notify('error', problem);
    return false;
  }
  const doc = { ...createDocument(Math.round(width), Math.round(height)), background };
  // Assets are immutable and uniquely keyed, so they are kept: the clipboard may still use them.
  ed.openDocument(doc, UNTITLED);
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


/** File name suggested when saving. Untitled documents get an ASCII name, which every browser keeps. */
function projectName(fileName: string): string {
  const base = fileName === UNTITLED ? 'untitled' : fileName;
  return base.endsWith(PROJECT_EXTENSION) ? base : `${base}${PROJECT_EXTENSION}`;
}

export async function saveProject(ed: EditorStore, saveAs = false): Promise<boolean> {
  const { doc, fileName, fileHandle } = ed.getState();
  try {
    ed.set({ busy: '保存中…' });
    const data = await writeProject(doc, (id) => assets.get(id)?.blob);
    const blob = new Blob([data as BlobPart], { type: PROJECT_MIME });
    const handle = await saveBlob(
      blob,
      projectName(fileName),
      { description: 'HANABI プロジェクト', accept: { [PROJECT_MIME]: [PROJECT_EXTENSION] } },
      saveAs ? null : fileHandle,
    );
    if (handle === undefined) return false;
    // The user may have switched tabs while saving: only mark the saved document.
    if (ed.getState().doc === doc) ed.markSaved(handle ? handle.name : projectName(fileName), handle);
    else ed.notify('info', `「${fileName}」を保存しました。保存後の変更は未保存です。`);
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
    for (const [id, blob] of blobs) assets.put(doc.assets[id], blob);
    ed.openDocument(doc, file.name);
  } catch (e) {
    ed.notify('error', e instanceof ProjectError ? e.message : `「${file.name}」を開けませんでした: ${describeError(e)}`);
  } finally {
    ed.set({ busy: null });
  }
}

/**
 * Open an image file as a new document the size of the image (like Fireworks).
 * The image becomes an image object at (0, 0) on a transparent canvas, so PNG/GIF
 * transparency is preserved.
 */
export async function openImageFile(ed: EditorStore, file: File): Promise<void> {
  try {
    ed.set({ busy: `「${file.name}」を読み込み中…` });
    const meta = await importImageFile(file, file.name);
    const doc = { ...createDocument(meta.width, meta.height), background: { kind: 'transparent' } as const };
    const img = createImage(meta, { x: 0, y: 0, width: meta.width, height: meta.height, rotation: 0 });
    doc.assets = { [meta.id]: meta };
    doc.layers[0].children.push(img);
    ed.openDocument(doc, stripImageExtension(file.name));
    ed.select([img.id]);
  } catch (e) {
    ed.notify('error', e instanceof ImageLoadError ? e.message : `「${file.name}」を開けませんでした: ${describeError(e)}`);
  } finally {
    ed.set({ busy: null });
  }
}

/** Projects are ZIP files: decide by content ("PK" signature), falling back to the extension. */
async function isProjectFile(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return true;
  return file.name.toLowerCase().endsWith(PROJECT_EXTENSION);
}

/** Open one file in a new tab: a .hnb project, or a PNG / JPEG / GIF / BMP image. */
export async function openFile(ed: EditorStore, file: File): Promise<void> {
  if (await isProjectFile(file)) await openProjectFile(ed, file);
  else await openImageFile(ed, file);
}

/** File → 開く: one or more files, each in its own tab. */
export async function chooseAndOpenProject(ed: EditorStore): Promise<void> {
  const files = await pickFiles(`${PROJECT_EXTENSION},${PROJECT_MIME},${IMAGE_ACCEPT}`, true);
  for (const file of files) await openFile(ed, file);
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
  clipboardAssets = {};
  walkObjects(clipboard, (o) => {
    if (o.type === 'image' && doc.assets[o.assetId]) clipboardAssets[o.assetId] = doc.assets[o.assetId];
  });
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
  const metas = clipboardAssets;
  const offset = pasteCount * 10;
  ed.edit('ペースト', (d) => {
    for (const [id, meta] of Object.entries(metas)) if (!d.assets[id]) d.assets[id] = meta;
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

/**
 * Align selected objects. Relative to their common bounds, or to the canvas when
 * `toCanvas` is set (always for a single object, which has nothing else to align to).
 */
export function alignSelection(ed: EditorStore, op: AlignOp, toCanvas = false): void {
  const { doc } = ed.getState();
  const ids = editableSelection(ed);
  const objs = ids.map((id) => findObject(doc, id)!.object);
  if (!objs.length) return;
  const target = objs.length === 1 || toCanvas ? { x: 0, y: 0, width: doc.width, height: doc.height } : unionBounds(objs)!;
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
