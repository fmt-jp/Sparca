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
import { cloneWithNewIds, findObject, isEffectivelyLocked, walkObjects } from '../model/tree';
import type { Background, SceneObject, SparcaDocument } from '../model/types';
import { IMAGE_ACCEPT, stripImageExtension } from '../io/imageFormats';
import { isAbort, pickFiles, pickSaveFile, saveBlob } from '../io/files';
import { EDITABLE_PNG_EXTENSION, EditablePngError, embedProject, extractProject, isEditablePngName, isPng } from '../io/editablePng';
import { exportImage, ExportError } from '../io/export';
import { newMask, settleMask } from '../model/mask';
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
        addObject(d, layerId, img, ed.getState().maskEdit);
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
  const { doc, maskEdit } = ed.getState();
  // While editing a mask, new objects go into it (on the masked object's layer).
  const owner = maskEdit ? findObject(doc, maskEdit) : null;
  if (owner) return owner.layer.id;
  const layer = doc.layers.find((l) => l.id === preferredId);
  if (layer && !layer.locked) return layer.id;
  if (layer?.locked) {
    ed.notify('error', `レイヤー「${layer.name}」はロックされています。ロックを解除するか、別のレイヤーを選んでください。`);
    return null;
  }
  return doc.layers[doc.layers.length - 1]?.id ?? null;
}

// ---- Project save / open ----


/**
 * File name suggested when saving: kept when it already is a project (.hnb) or an editable
 * PNG (.png); anything else (untitled, an opened photo) becomes an editable PNG, the default
 * (decided with the user 2026-11-03). Untitled documents get an ASCII name, which every browser keeps.
 */
export function projectName(fileName: string): string {
  const base = fileName === UNTITLED ? 'untitled' : fileName;
  const lower = base.toLowerCase();
  return lower.endsWith(PROJECT_EXTENSION) || lower.endsWith('.png') ? base : `${base}${EDITABLE_PNG_EXTENSION}`;
}

// The save dialog offers one type only, chosen in HANABI (保存 / 名前を付けて保存 keep the file's
// format; 「編集できる PNG として保存」「HANABI プロジェクト（.hnb）として保存」 pick one): when it
// offers both, switching the type there replaces only the last part of the extension
// (作品.hnb.png → 作品.hnb.hnb), which cannot give the right name both ways (user report 2026-11-03).
/** 作品.hnb.png / 作品.hnb / 作品.png → 作品. */
export function withoutProjectExtension(name: string): string {
  return name.replace(/(\.hnb)?\.png$/i, '').replace(/\.hnb$/i, '');
}

const PNG_TYPE = { description: '編集できる PNG（HANABI）', accept: { 'image/png': [EDITABLE_PNG_EXTENSION, '.png'] } };
/** For browsers that refuse an extension with two dots. */
const PNG_TYPE_PLAIN = { description: '編集できる PNG（HANABI）', accept: { 'image/png': ['.png'] } };
const HNB_TYPE = { description: 'HANABI プロジェクト', accept: { [PROJECT_MIME]: [PROJECT_EXTENSION] } };

export type SaveFormat = 'png' | 'hnb';

/**
 * Save as an editable PNG (the canvas as a picture, with the project inside) or a .hnb project.
 * - 保存 (Ctrl+S): overwrites the file (its format); the first save of a new document asks where.
 * - 名前を付けて保存 (Ctrl+Shift+S): asks for a new name, same format as the file (new: PNG).
 * - with `format`: asks for a name and saves in that format.
 */
export async function saveProject(ed: EditorStore, saveAs = false, format?: SaveFormat): Promise<boolean> {
  const { doc, fileName, fileHandle } = ed.getState();
  try {
    const current: SaveFormat = isEditablePngName(projectName(fileName)) ? 'png' : 'hnb';
    const fmt = format ?? current;
    const suggested = withoutProjectExtension(projectName(fileName)) + (fmt === 'png' ? EDITABLE_PNG_EXTENSION : PROJECT_EXTENSION);
    // Ask where to save first; a known file in the same format is overwritten.
    let target = saveAs || fmt !== current ? null : fileHandle;
    if (!target) {
      let picked;
      try {
        picked = await pickSaveFile(suggested, fmt === 'png' ? PNG_TYPE : HNB_TYPE);
      } catch (e) {
        // An invalid accept list is refused before the dialog opens (TypeError).
        if (!(e instanceof TypeError) || fmt !== 'png') throw e;
        picked = await pickSaveFile(suggested, PNG_TYPE_PLAIN);
      }
      if (picked === undefined) return false;
      target = picked;
    }
    const name = target?.name ?? suggested;
    // The name decides when it says (a typed 作品.hnb in the PNG dialog); otherwise the chosen format.
    const known = isEditablePngName(name) || name.toLowerCase().endsWith(PROJECT_EXTENSION);
    const asPng = known ? isEditablePngName(name) : fmt === 'png';
    ed.set({ busy: '保存中…' });
    const data = await writeProject(doc, (id) => assets.get(id)?.blob);
    let blob = new Blob([data as BlobPart], { type: PROJECT_MIME });
    if (asPng) {
      const picture = new Uint8Array(await (await exportImage(doc, { format: 'png', quality: 100, jpegBackground: '#ffffff' })).arrayBuffer());
      blob = new Blob([embedProject(picture, data) as BlobPart], { type: 'image/png' });
    }
    const handle = await saveBlob(blob, name, asPng ? PNG_TYPE : HNB_TYPE, target);
    if (handle === undefined) return false;
    // The user may have switched tabs while saving: only mark the saved document.
    if (ed.getState().doc === doc) ed.markSaved(handle ? handle.name : name, handle);
    else ed.notify('info', `「${fileName}」を保存しました。保存後の変更は未保存です。`);
    ed.notify('info', '保存しました。');
    return true;
  } catch (e) {
    ed.notify(
      'error',
      e instanceof ProjectError || e instanceof EditablePngError ? e.message : e instanceof ExportError ? `保存に失敗しました: ${e.message}` : `保存に失敗しました: ${describeError(e)}`,
    );
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

/**
 * Projects are ZIP files or editable PNGs: decide by content ("PK" signature, or a PNG that
 * carries the project chunk), falling back to the .hnb extension.
 */
async function isProjectFile(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return true;
  if (isPng(head)) {
    try {
      return extractProject(new Uint8Array(await file.arrayBuffer())) !== null;
    } catch {
      return true; // a damaged project chunk: report it as a project error
    }
  }
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
  pixelCopySize = null;
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
    ids = pasteObjects(d, layerId, objs, offset, offset, ed.getState().maskEdit);
  });
  ed.select(ids);
}

/**
 * マスクとして貼り付け: the copied objects become (more of) the mask of the one selected object,
 * where they were copied (decided with the user 2026-11-05: an existing mask gets them added;
 * a new mask has a black background, so their light parts show the object). One undo step.
 */
export function pasteAsMask(ed: EditorStore): boolean {
  const { doc, selection } = ed.getState();
  const loc = selection.length === 1 ? findObject(doc, selection[0]) : null;
  if (!loc || loc.maskOwner || isEffectivelyLocked(loc)) {
    ed.notify('error', 'マスクを付けるオブジェクトを 1 つ選択してください。');
    return false;
  }
  if (!clipboard.length) {
    ed.notify('error', 'マスクにするもの（図形・テキスト・画像など）を先にコピーしてください。');
    return false;
  }
  const target = loc.object;
  const objs = clipboard;
  const metas = clipboardAssets;
  ed.edit('マスクとして貼り付け', (d) => {
    for (const [id, meta] of Object.entries(metas)) if (!d.assets[id]) d.assets[id] = meta;
    const t = findObject(d, target.id);
    if (!t) return;
    const mask = settleMask(t.object) ?? newMask(t.object, 'black');
    if (!mask) return;
    t.object.mask = { ...mask, children: [...mask.children, ...objs.map((o) => cloneWithNewIds(o))] };
  });
  ed.select([target.id]);
  return true;
}

export function canPasteAsMask(ed: EditorStore): boolean {
  const { doc, selection } = ed.getState();
  const loc = selection.length === 1 ? findObject(doc, selection[0]) : null;
  return !!loc && !loc.maskOwner && !isEffectivelyLocked(loc) && clipboard.length > 0;
}

/** Size of the image a selection copy put on the clipboard (null when the clipboard holds objects). */
let pixelCopySize: { width: number; height: number } | null = null;

/**
 * Put copied selection pixels on HANABI's clipboard as a new image object at the place
 * they came from; the first paste puts it back in place (like Fireworks), later ones offset.
 */
export async function setPixelClipboard(copy: { png: Blob; rect: { x: number; y: number; width: number; height: number }; source: string }): Promise<void> {
  const meta = await importImageFile(copy.png, `${copy.source}（選択範囲）`);
  clipboard = [createImage(meta, { ...copy.rect, rotation: 0 })];
  clipboardAssets = { [meta.id]: meta };
  pasteCount = -1;
  pixelCopySize = { width: meta.width, height: meta.height };
}

/** Whether an image of this size on the system clipboard is HANABI's own latest selection copy. */
export function isPixelCopy(width: number, height: number): boolean {
  return !!pixelCopySize && pixelCopySize.width === width && pixelCopySize.height === height;
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

export type AlignOp = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'distribute-h' | 'distribute-v';

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
  if (op === 'distribute-h' || op === 'distribute-v') {
    distribute(ed, objs, op === 'distribute-h' ? 'x' : 'y', target, toCanvas);
    return;
  }
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

/**
 * Space objects evenly along one axis: the gaps between neighbors become equal. The
 * first and last stay where they are, or go to the canvas edges with `toCanvas`.
 */
function distribute(ed: EditorStore, objs: SceneObject[], axis: 'x' | 'y', target: { x: number; y: number; width: number; height: number }, toCanvas: boolean): void {
  const min = toCanvas ? 2 : 3;
  if (objs.length < min) {
    ed.notify('info', toCanvas ? '均等配置には2つ以上のオブジェクトを選択してください。' : '均等配置には3つ以上のオブジェクトを選択してください（キャンバスに対してなら2つ以上）。');
    return;
  }
  const size = axis === 'x' ? 'width' : 'height';
  const items = objs
    .map((o) => ({ o, b: unionBounds([o])! }))
    .filter((it) => it.b)
    .sort((a, b) => a.b[axis] + a.b[size] / 2 - (b.b[axis] + b.b[size] / 2));
  const span = toCanvas ? { start: target[axis], end: target[axis] + target[size] } : { start: items[0].b[axis], end: items[items.length - 1].b[axis] + items[items.length - 1].b[size] };
  const total = items.reduce((s, it) => s + it.b[size], 0);
  const gap = (span.end - span.start - total) / (items.length - 1);
  ed.edit('均等配置', (d) => {
    let at = span.start;
    for (const it of items) {
      const delta = at - it.b[axis];
      transformObjects(d, [it.o.id], { ...IDENTITY_TRANSFORM, dx: axis === 'x' ? delta : 0, dy: axis === 'y' ? delta : 0 });
      at += it.b[size] + gap;
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
