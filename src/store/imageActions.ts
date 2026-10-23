// Raster-related editor actions (spec §7).
import { updateObject } from '../model/commands';
import { boundsOfPoints, boxCorners, objectBounds, rectsIntersect, toLocal, type Rect } from '../model/geometry';
import { addLocalBlur, addLocalMosaic, cropDocument, cropImage, fitCanvasToObject, resizeCanvas, resizeImagePixels, selectionToImageMask, type Anchor } from '../model/imageOps';
import { allObjects, findObject, isEffectivelyLocked, isEffectivelyVisible } from '../model/tree';
import { defaultAdjust } from '../model/factory';
import type { ColorAdjust, Id, ImageObject, MaskShape, ResampleMethod, SceneObject } from '../model/types';
import { imageCache } from '../render/imageCache';
import { validateDimensions } from './assets';
import { GROW_LIMIT, type EditorStore, type PixelSelection } from './editor';
import { edgeOutline } from '../engine/mask';
import { pipelineOutputSize } from '../engine/pipeline';

/** The selected image object, if exactly one editable image is selected. */
export function selectedImage(ed: EditorStore): ImageObject | null {
  const { doc, selection } = ed.getState();
  if (selection.length !== 1) return null;
  const loc = findObject(doc, selection[0]);
  if (!loc || loc.object.type !== 'image' || isEffectivelyLocked(loc)) return null;
  return loc.object;
}

/** Image a pixel operation applies to: the selected image, or the topmost visible image under the selection. */
export function pixelTargetImage(ed: EditorStore): ImageObject | null {
  const sel = selectedImage(ed);
  if (sel) return sel;
  const { doc, pixelSelection } = ed.getState();
  if (!pixelSelection) return null;
  const selBounds = pixelSelectionBounds(pixelSelection);
  const images = allObjects(doc).filter((o): o is ImageObject => o.type === 'image');
  for (const img of images.reverse()) {
    const loc = findObject(doc, img.id)!;
    if (!isEffectivelyVisible(loc) || isEffectivelyLocked(loc)) continue;
    const b = objectBounds(img);
    if (b && rectsIntersect(b, selBounds)) return img;
  }
  return null;
}

/** Bounds of a pixel selection, including how far grow and feather reach. */
export function pixelSelectionBounds(s: PixelSelection): Rect {
  const b = s.kind === 'polygon' ? boundsOfPoints(s.points) : { x: s.x, y: s.y, width: s.width, height: s.height };
  const m = Math.max(0, s.grow ?? 0) + (s.feather ?? 0);
  return m > 0 ? { x: b.x - m, y: b.y - m, width: b.width + m * 2, height: b.height + m * 2 } : b;
}

/**
 * Expand (px > 0) or contract (px < 0) the pixel selection by a distance in document px
 * (Fireworks 選択範囲を拡張／縮小). Repeated calls add up. Returns false (with an error
 * shown) when there is no selection or nothing would be left of it.
 */
export function growSelection(ed: EditorStore, px: number): boolean {
  const sel = ed.getState().pixelSelection;
  if (!sel) {
    ed.notify('error', '範囲選択がありません。範囲選択ツールで範囲を指定してください。');
    return false;
  }
  const grow = Math.max(-GROW_LIMIT, Math.min(GROW_LIMIT, (sel.grow ?? 0) + px));
  const next: PixelSelection = { ...sel, grow };
  if (Math.abs(grow) < 0.01) delete next.grow;
  else if (!edgeOutline({ ...next, feather: 0 })?.length) {
    ed.notify('error', `${Math.abs(px)} px 縮小すると選択範囲がなくなります。`);
    return false;
  }
  ed.set({ pixelSelection: next });
  return true;
}

export function setAdjust(ed: EditorStore, id: Id, patch: Partial<ColorAdjust>, label: string, mergeKey?: string): void {
  const loc = findObject(ed.getState().doc, id);
  if (!loc || loc.object.type !== 'image') return;
  const pipeline = { ...loc.object.pipeline, adjust: { ...loc.object.pipeline.adjust, ...patch } };
  ed.edit(label, (d) => updateObject(d, id, { pipeline } as Partial<SceneObject>), mergeKey ? `${mergeKey}:${id}` : null);
}

export async function autoColor(ed: EditorStore, id: Id): Promise<void> {
  const loc = findObject(ed.getState().doc, id);
  if (!loc || loc.object.type !== 'image') return;
  try {
    ed.set({ busy: '画像を解析中…' });
    const params = await imageCache.analyzeAuto(loc.object);
    setAdjust(ed, id, { auto: params }, '自動カラー調整');
  } catch (e) {
    ed.notify('error', `自動カラー調整に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    ed.set({ busy: null });
  }
}

export function resetAdjust(ed: EditorStore, id: Id): void {
  const loc = findObject(ed.getState().doc, id);
  if (!loc || loc.object.type !== 'image') return;
  const pipeline = {
    ...loc.object.pipeline,
    adjust: defaultAdjust(),
    localEdits: [],
  };
  ed.edit('調整をリセット', (d) => updateObject(d, id, { pipeline } as Partial<SceneObject>));
}

/** The target image and the pixel selection as its mask, or null (with an error shown unless quiet). */
function selectionTarget(ed: EditorStore, quiet = false): { img: ImageObject; mask: MaskShape } | null {
  const { pixelSelection } = ed.getState();
  if (!pixelSelection) {
    if (!quiet) ed.notify('error', '範囲選択がありません。範囲選択ツールで範囲を指定してください。');
    return null;
  }
  const img = pixelTargetImage(ed);
  if (!img) {
    if (!quiet) ed.notify('error', '選択範囲に重なる編集可能な画像がありません。');
    return null;
  }
  // Edge lengths are document px; the mask needs px of the processed image.
  const asset = ed.getState().doc.assets[img.assetId];
  const size = asset ? pipelineOutputSize(img.pipeline, asset.width, asset.height) : img.box;
  const pxPerDoc = (size.width / img.box.width + size.height / img.box.height) / 2;
  return { img, mask: selectionToImageMask(img, pixelSelection, pxPerDoc) };
}

/** Apply a gaussian blur to the pixel selection on the target image. */
export function blurSelection(ed: EditorStore, radius: number): boolean {
  const t = selectionTarget(ed);
  if (!t) return false;
  ed.edit('選択範囲にぼかし', (d) => addLocalBlur(d, t.img.id, t.mask, radius));
  return true;
}

export const SELECTION_EDIT_LABELS = { blur: '選択範囲にぼかし', mosaic: '選択範囲にモザイク' } as const;

/**
 * Show a selection blur / mosaic on the canvas before it is applied: the edit runs inside
 * a gesture, replacing the previous preview. Finish with endGesture (apply) or
 * cancelGesture (back to before). Returns false when there is nothing to preview.
 */
export function previewSelectionEdit(ed: EditorStore, kind: 'blur' | 'mosaic', value: number): boolean {
  ed.cancelGesture();
  const t = selectionTarget(ed, true);
  if (!t) return false;
  ed.beginGesture();
  ed.edit(SELECTION_EDIT_LABELS[kind], (d) => (kind === 'blur' ? addLocalBlur(d, t.img.id, t.mask, value) : addLocalMosaic(d, t.img.id, t.mask, value)));
  return true;
}

/** Pixelate the pixel selection on the target image with `size`-px blocks. */
export function mosaicSelection(ed: EditorStore, size: number): boolean {
  const t = selectionTarget(ed);
  if (!t) return false;
  ed.edit('選択範囲にモザイク', (d) => addLocalMosaic(d, t.img.id, t.mask, size));
  return true;
}

/**
 * Set an image's pixel size. With `fitCanvas`, the canvas also becomes the image's new size
 * (image at 0,0; other objects keep their position relative to it) in the same undo step.
 */
export function resizeImage(ed: EditorStore, id: Id, width: number, height: number, method: ResampleMethod, fitCanvas = false): boolean {
  const problem = validateDimensions(width, height);
  if (problem) {
    ed.notify('error', problem);
    return false;
  }
  const { doc } = ed.getState();
  const loc = findObject(doc, id);
  if (!loc || loc.object.type !== 'image') return false;
  const meta = doc.assets[loc.object.assetId];
  ed.edit(fitCanvas ? '画像サイズとキャンバスサイズの変更' : '画像サイズの変更', (d) => {
    resizeImagePixels(d, id, width, height, method, meta.width, meta.height);
    if (fitCanvas) fitCanvasToObject(d, id);
  });
  return true;
}

export function changeCanvasSize(ed: EditorStore, width: number, height: number, anchor: Anchor): boolean {
  const problem = validateDimensions(width, height);
  if (problem) {
    ed.notify('error', problem);
    return false;
  }
  ed.edit('キャンバスサイズの変更', (d) => resizeCanvas(d, Math.round(width), Math.round(height), anchor));
  return true;
}

// ---- Crop tool ----

export function startCrop(ed: EditorStore): void {
  const img = selectedImage(ed);
  ed.set({ crop: { target: img ? 'image' : 'document', imageId: img?.id ?? null, rect: null } });
}

export function setCropTarget(ed: EditorStore, target: 'document' | 'image'): void {
  const img = selectedImage(ed);
  if (target === 'image' && !img) {
    ed.notify('error', '画像のトリミングには、画像を1つ選択してください。');
    return;
  }
  ed.set({ crop: { target, imageId: target === 'image' ? img!.id : null, rect: null } });
}

export function commitCrop(ed: EditorStore): void {
  const { crop, doc } = ed.getState();
  if (!crop?.rect || crop.rect.width < 1 || crop.rect.height < 1) {
    ed.notify('error', 'トリミング範囲をドラッグで指定してください。');
    return;
  }
  const r = crop.rect;
  if (crop.target === 'document') {
    ed.edit('キャンバスのトリミング', (d) => cropDocument(d, r));
  } else {
    const loc = crop.imageId ? findObject(doc, crop.imageId) : null;
    if (!loc || loc.object.type !== 'image') {
      ed.notify('error', 'トリミング対象の画像が見つかりません。');
      return;
    }
    const img = loc.object;
    // Rect corners in the image's local frame → fractions of its box.
    const b = img.box;
    const local = boundsOfPoints(
      boxCorners({ ...r, rotation: 0 }).map((p) => toLocal(b, p)),
    );
    const f = {
      x: Math.max(0, local.x / b.width),
      y: Math.max(0, local.y / b.height),
      width: Math.min(1, (local.x + local.width) / b.width) - Math.max(0, local.x / b.width),
      height: Math.min(1, (local.y + local.height) / b.height) - Math.max(0, local.y / b.height),
    };
    if (f.width <= 0 || f.height <= 0) {
      ed.notify('error', 'トリミング範囲が画像と重なっていません。');
      return;
    }
    const meta = doc.assets[img.assetId];
    ed.edit('画像のトリミング', (d) => cropImage(d, img.id, f, meta.width, meta.height));
  }
  ed.set({ crop: { ...crop, rect: null } });
}

export function cancelCrop(ed: EditorStore): void {
  const { crop } = ed.getState();
  if (crop) ed.set({ crop: { ...crop, rect: null } });
}
