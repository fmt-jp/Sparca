// Canvas and raster-object operations (spec §7). Document-level operations (canvas size,
// document crop) and per-image operations (image crop, image resize) are kept separate.
import { boxCenter, objectBounds, rotatePoint, toLocal, transformObject, IDENTITY_TRANSFORM, type Rect } from './geometry';
import { findObject } from './tree';
import type { Id, ImageObject, MaskShape, Point, ResampleMethod, SparcaDocument } from './types';

/** Anchor as fractions: (0,0) = top-left … (1,1) = bottom-right. */
export interface Anchor {
  x: 0 | 0.5 | 1;
  y: 0 | 0.5 | 1;
}

export const ANCHORS: { anchor: Anchor; label: string }[] = [
  { anchor: { x: 0, y: 0 }, label: '左上' },
  { anchor: { x: 0.5, y: 0 }, label: '上中央' },
  { anchor: { x: 1, y: 0 }, label: '右上' },
  { anchor: { x: 0, y: 0.5 }, label: '左中央' },
  { anchor: { x: 0.5, y: 0.5 }, label: '中央' },
  { anchor: { x: 1, y: 0.5 }, label: '右中央' },
  { anchor: { x: 0, y: 1 }, label: '左下' },
  { anchor: { x: 0.5, y: 1 }, label: '下中央' },
  { anchor: { x: 1, y: 1 }, label: '右下' },
];

/** Offset applied to existing content when the canvas changes size around an anchor. */
export function canvasOffset(oldW: number, oldH: number, newW: number, newH: number, a: Anchor): Point {
  return { x: (newW - oldW) * a.x, y: (newH - oldH) * a.y };
}

/** Translate every object (including locked ones: this is a document-level change). */
function translateAll(doc: SparcaDocument, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  for (const layer of doc.layers) {
    layer.children = layer.children.map((o) => transformObject(o, { ...IDENTITY_TRANSFORM, dx, dy }));
  }
}

/**
 * Change canvas dimensions keeping content at the anchor. Objects are not scaled;
 * objects that fall outside stay in the document (spec §7.3).
 */
export function resizeCanvas(doc: SparcaDocument, width: number, height: number, anchor: Anchor): void {
  const off = canvasOffset(doc.width, doc.height, width, height, anchor);
  translateAll(doc, off.x, off.y);
  doc.width = width;
  doc.height = height;
}

/** Crop the document to a rectangle in document coordinates. */
export function cropDocument(doc: SparcaDocument, r: Rect): void {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  translateAll(doc, -x, -y);
  doc.width = w;
  doc.height = h;
}

/** Size in pixels of the image's source region after its crop (before resize). */
export function croppedSourceSize(o: ImageObject, srcW: number, srcH: number): { width: number; height: number } {
  return o.pipeline.crop
    ? { width: Math.round(o.pipeline.crop.width), height: Math.round(o.pipeline.crop.height) }
    : { width: srcW, height: srcH };
}

/**
 * Crop an image object to a rectangle given as fractions of its current box
 * (fx, fy, fw, fh in 0..1). Updates the source crop, any resize, local-edit masks and the box.
 */
export function cropImage(doc: SparcaDocument, id: Id, f: Rect, srcW: number, srcH: number): void {
  const loc = findObject(doc, id);
  if (!loc || loc.object.type !== 'image') return;
  const o = loc.object;
  const fx = Math.max(0, Math.min(1, f.x));
  const fy = Math.max(0, Math.min(1, f.y));
  const fw = Math.max(1e-6, Math.min(1 - fx, f.width));
  const fh = Math.max(1e-6, Math.min(1 - fy, f.height));
  const prev = o.pipeline.crop ?? { x: 0, y: 0, width: srcW, height: srcH };
  const crop = {
    x: Math.round(prev.x + fx * prev.width),
    y: Math.round(prev.y + fy * prev.height),
    width: Math.max(1, Math.round(fw * prev.width)),
    height: Math.max(1, Math.round(fh * prev.height)),
  };
  // The output keeps the same pixel density, so a resize shrinks proportionally.
  const resize = o.pipeline.resize
    ? {
        ...o.pipeline.resize,
        width: Math.max(1, Math.round(o.pipeline.resize.width * fw)),
        height: Math.max(1, Math.round(o.pipeline.resize.height * fh)),
      }
    : null;
  const localEdits = o.pipeline.localEdits.map((e) => ({ ...e, mask: remapMask(e.mask, fx, fy, fw, fh) }));
  // New box: the sub-rectangle of the old box, same rotation.
  const b = o.box;
  const localCenter = { x: b.x + (fx + fw / 2) * b.width, y: b.y + (fy + fh / 2) * b.height };
  const c = rotatePoint(localCenter, boxCenter(b), b.rotation);
  const w = b.width * fw;
  const h = b.height * fh;
  o.box = { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h, rotation: b.rotation };
  o.pipeline = { ...o.pipeline, crop, resize, localEdits };
}

function remapMask(m: MaskShape, fx: number, fy: number, fw: number, fh: number): MaskShape {
  const px = (x: number) => (x - fx) / fw;
  const py = (y: number) => (y - fy) / fh;
  if (m.kind === 'polygon') return { kind: 'polygon', points: m.points.map((p) => ({ x: px(p.x), y: py(p.y) })) };
  return { ...m, x: px(m.x), y: py(m.y), width: m.width / fw, height: m.height / fh };
}

/**
 * Set the pixel dimensions of an image object (spec §7.1). The box is resized to show the
 * new pixels 1:1 around its current center so the chosen interpolation is what you see.
 */
export function resizeImagePixels(doc: SparcaDocument, id: Id, width: number, height: number, method: ResampleMethod, srcW: number, srcH: number): void {
  const loc = findObject(doc, id);
  if (!loc || loc.object.type !== 'image') return;
  const o = loc.object;
  const base = croppedSourceSize(o, srcW, srcH);
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const resize = w === base.width && h === base.height ? null : { width: w, height: h, method };
  const c = boxCenter(o.box);
  o.box = { ...o.box, x: c.x - w / 2, y: c.y - h / 2, width: w, height: h };
  o.pipeline = { ...o.pipeline, resize };
}

/** Convert a pixel selection (document coordinates) into a mask in the image's normalized frame. */
export function selectionToImageMask(o: ImageObject, sel: MaskShape): MaskShape {
  const b = o.box;
  const norm = (p: Point): Point => {
    const l = toLocal(b, p);
    return { x: l.x / b.width, y: l.y / b.height };
  };
  if (sel.kind === 'polygon') return { kind: 'polygon', points: sel.points.map(norm) };
  if (b.rotation === 0) {
    return {
      kind: sel.kind,
      x: (sel.x - b.x) / b.width,
      y: (sel.y - b.y) / b.height,
      width: sel.width / b.width,
      height: sel.height / b.height,
    };
  }
  // Rotated image: an axis-aligned rect/ellipse becomes a rotated shape; use a polygon.
  const pts: Point[] = [];
  const n = sel.kind === 'rect' ? 4 : 96;
  for (let i = 0; i < n; i++) {
    if (sel.kind === 'rect') {
      const cx = [0, 1, 1, 0][i];
      const cy = [0, 0, 1, 1][i];
      pts.push({ x: sel.x + cx * sel.width, y: sel.y + cy * sel.height });
    } else {
      const a = (i / n) * Math.PI * 2;
      pts.push({
        x: sel.x + sel.width / 2 + (Math.cos(a) * sel.width) / 2,
        y: sel.y + sel.height / 2 + (Math.sin(a) * sel.height) / 2,
      });
    }
  }
  return { kind: 'polygon', points: pts.map(norm) };
}

export function addLocalBlur(doc: SparcaDocument, id: Id, mask: MaskShape, radius: number): void {
  const loc = findObject(doc, id);
  if (!loc || loc.object.type !== 'image') return;
  loc.object.pipeline.localEdits.push({ kind: 'blur', radius, mask });
}

/** Whether an object exactly covers the canvas (e.g. an image opened as a document). */
export function coversCanvas(doc: SparcaDocument, id: Id): boolean {
  const loc = findObject(doc, id);
  if (!loc || loc.object.type === 'group') return false;
  const b = loc.object.box;
  const near = (a: number, c: number) => Math.abs(a - c) < 0.5;
  return b.rotation === 0 && near(b.x, 0) && near(b.y, 0) && near(b.width, doc.width) && near(b.height, doc.height);
}

/**
 * Make the canvas exactly the object's bounds: the object ends up at (0, 0) and every
 * other object moves with it, keeping their positions relative to it. Nothing is scaled.
 */
export function fitCanvasToObject(doc: SparcaDocument, id: Id): void {
  const loc = findObject(doc, id);
  if (!loc) return;
  const b = objectBounds(loc.object);
  if (!b) return;
  // Exact offset (not rounded) so the object lands precisely at (0, 0).
  translateAll(doc, -b.x, -b.y);
  doc.width = Math.max(1, Math.round(b.width));
  doc.height = Math.max(1, Math.round(b.height));
}
