// Copy the pixels inside the pixel selection (Fireworks: marquee + コピー). The result is a
// new image at document resolution: the target image's processed pixels (crop, resize,
// color adjustments and partial edits; not its effects), sampled at each document pixel
// and cut out by the selection's coverage, so hard / feathered / grown edges carry over.
import { rasterizeMask } from '../engine/mask';
import { objectBounds, toLocal, type Rect } from '../model/geometry';
import type { ImageObject, MaskShape } from '../model/types';
import { imageCache } from '../render/imageCache';
import { validateDimensions } from './assets';
import type { EditorStore, PixelSelection } from './editor';
import { pixelSelectionBounds, pixelTargetImage } from './imageActions';

export interface PixelCopy {
  png: Blob;
  /** Where the copied pixels were, in document coordinates (1 px = 1 document px). */
  rect: Rect;
  /** Name of the image the pixels came from. */
  source: string;
}

/** The selection in normalized coordinates of `frame` (edge lengths stay in px = document px). */
function selectionInFrame(sel: PixelSelection, f: Rect): MaskShape {
  if (sel.kind === 'polygon') return { ...sel, points: sel.points.map((p) => ({ x: (p.x - f.x) / f.width, y: (p.y - f.y) / f.height })) };
  return { ...sel, x: (sel.x - f.x) / f.width, y: (sel.y - f.y) / f.height, width: sel.width / f.width, height: sel.height / f.height };
}

/** Area to copy: the selection (with its grow / feather reach) inside the image, in whole document pixels. */
function copyRect(sel: PixelSelection, img: ImageObject): Rect | null {
  const a = pixelSelectionBounds(sel);
  const b = objectBounds(img)!;
  const x0 = Math.floor(Math.max(a.x, b.x));
  const y0 = Math.floor(Math.max(a.y, b.y));
  const x1 = Math.ceil(Math.min(a.x + a.width, b.x + b.width));
  const y1 = Math.ceil(Math.min(a.y + a.height, b.y + b.height));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/**
 * Whether a selection copy applies now: there is a pixel selection over an editable image.
 * (Otherwise コピー copies the selected objects as before.)
 */
export function canCopyPixels(ed: EditorStore): boolean {
  return !!ed.getState().pixelSelection && !!pixelTargetImage(ed);
}

/** Render the selected pixels of the target image as a PNG. Errors are shown and give null. */
export async function copySelectionPixels(ed: EditorStore): Promise<PixelCopy | null> {
  const sel = ed.getState().pixelSelection;
  const img = sel && pixelTargetImage(ed);
  if (!sel || !img) {
    ed.notify('error', '範囲選択に重なる編集可能な画像がありません。');
    return null;
  }
  const rect = copyRect(sel, img);
  if (!rect) {
    ed.notify('error', '選択範囲が画像に重なっていません。');
    return null;
  }
  const problem = validateDimensions(rect.width, rect.height);
  if (problem) {
    ed.notify('error', problem);
    return null;
  }
  try {
    ed.set({ busy: '選択範囲をコピー中…' });
    const bmp = await createImageBitmap(await imageCache.fullBlob(img));
    const src = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!;
    src.drawImage(bmp, 0, 0);
    const sw = bmp.width;
    const sh = bmp.height;
    const s = src.getImageData(0, 0, sw, sh).data;
    bmp.close();

    const { width: w, height: h } = rect;
    const mask = rasterizeMask(selectionInFrame(sel, rect), w, h);
    const out = new ImageData(w, h);
    const d = out.data;
    const kx = sw / img.box.width;
    const ky = sh / img.box.height;
    // Bilinear sampling with premultiplied alpha; exact copies for unrotated 1:1 images.
    const px = (x: number, y: number, c: number) => s[(y * sw + x) * 4 + c];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const m = mask[j * w + i];
        if (m <= 0) continue;
        const l = toLocal(img.box, { x: rect.x + i + 0.5, y: rect.y + j + 0.5 });
        const fx = l.x * kx - 0.5;
        const fy = l.y * ky - 0.5;
        if (fx < -0.5 || fy < -0.5 || fx > sw - 0.5 || fy > sh - 0.5) continue;
        const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx)));
        const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
        const x1 = Math.min(sw - 1, x0 + 1);
        const y1 = Math.min(sh - 1, y0 + 1);
        const tx = Math.max(0, Math.min(1, fx - x0));
        const ty = Math.max(0, Math.min(1, fy - y0));
        const wts = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
        const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
        let a = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let k = 0; k < 4; k++) {
          const [x, y] = pts[k];
          const pa = (px(x, y, 3) / 255) * wts[k];
          a += pa;
          r += px(x, y, 0) * pa;
          g += px(x, y, 1) * pa;
          b += px(x, y, 2) * pa;
        }
        if (a <= 0) continue;
        const o = (j * w + i) * 4;
        d[o] = Math.round(r / a);
        d[o + 1] = Math.round(g / a);
        d[o + 2] = Math.round(b / a);
        d[o + 3] = Math.round(a * m * 255);
      }
    }
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.putImageData(out, 0, 0);
    return { png: await canvas.convertToBlob({ type: 'image/png' }), rect, source: img.name };
  } catch (e) {
    ed.notify('error', `選択範囲のコピーに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    ed.set({ busy: null });
  }
}
