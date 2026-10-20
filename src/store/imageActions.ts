// Raster-related editor actions (spec §7).
import { updateObject } from '../model/commands';
import { boundsOfPoints, boxCorners, objectBounds, rectsIntersect, toLocal, type Rect } from '../model/geometry';
import { addLocalBlur, cropDocument, cropImage, resizeCanvas, resizeImagePixels, selectionToImageMask, type Anchor } from '../model/imageOps';
import { allObjects, findObject, isEffectivelyLocked, isEffectivelyVisible } from '../model/tree';
import type { ColorAdjust, Id, ImageObject, MaskShape, ResampleMethod, SceneObject } from '../model/types';
import { imageCache } from '../render/imageCache';
import { validateDimensions } from './assets';
import type { EditorStore, PixelSelection } from './editor';

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

export function pixelSelectionBounds(s: PixelSelection): Rect {
  if (s.kind === 'polygon') return boundsOfPoints(s.points);
  return { x: s.x, y: s.y, width: s.width, height: s.height };
}

export function setAdjust(ed: EditorStore, id: Id, patch: Partial<ColorAdjust>, label: string, mergeKey?: string): void {
  const loc = findObject(ed.getState().doc, id);
  if (!loc || loc.object.type !== 'image') return;
  const pipeline = { ...loc.object.pipeline, adjust: { ...loc.object.pipeline.adjust, ...patch } };
  ed.edit(label, (d) => updateObject(d, id, { pipeline } as Partial<SceneObject>), mergeKey ? `${mergeKey}:${id}` : null);
}

export function setImageBlur(ed: EditorStore, id: Id, blur: number): void {
  const loc = findObject(ed.getState().doc, id);
  if (!loc || loc.object.type !== 'image') return;
  const pipeline = { ...loc.object.pipeline, blur };
  ed.edit('ぼかし', (d) => updateObject(d, id, { pipeline } as Partial<SceneObject>), `blur:${id}`);
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
    adjust: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, auto: null },
    blur: 0,
    localEdits: [],
  };
  ed.edit('調整をリセット', (d) => updateObject(d, id, { pipeline } as Partial<SceneObject>));
}

/** Apply a gaussian blur to the pixel selection on the target image. */
export function blurSelection(ed: EditorStore, radius: number): boolean {
  const { pixelSelection } = ed.getState();
  if (!pixelSelection) {
    ed.notify('error', '範囲選択がありません。範囲選択ツールで範囲を指定してください。');
    return false;
  }
  const img = pixelTargetImage(ed);
  if (!img) {
    ed.notify('error', '選択範囲に重なる編集可能な画像がありません。');
    return false;
  }
  const mask: MaskShape = selectionToImageMask(img, pixelSelection);
  ed.edit('選択範囲にぼかし', (d) => addLocalBlur(d, img.id, mask, radius));
  return true;
}

export function resizeImage(ed: EditorStore, id: Id, width: number, height: number, method: ResampleMethod): boolean {
  const problem = validateDimensions(width, height);
  if (problem) {
    ed.notify('error', problem);
    return false;
  }
  const { doc } = ed.getState();
  const loc = findObject(doc, id);
  if (!loc || loc.object.type !== 'image') return false;
  const meta = doc.assets[loc.object.assetId];
  ed.edit('画像サイズの変更', (d) => resizeImagePixels(d, id, width, height, method, meta.width, meta.height));
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
