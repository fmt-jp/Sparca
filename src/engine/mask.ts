// Rasterize a selection mask (image-normalized coordinates) into per-pixel coverage 0..1.
// Scanline fill with 4 vertical sub-samples and exact horizontal span coverage (anti-aliased edges).
import type { MaskShape, Point } from '../model/types';

const SUBSAMPLES = 4;
const ELLIPSE_SEGMENTS = 128;

export function maskPolygon(shape: MaskShape): Point[] {
  switch (shape.kind) {
    case 'rect':
      return [
        { x: shape.x, y: shape.y },
        { x: shape.x + shape.width, y: shape.y },
        { x: shape.x + shape.width, y: shape.y + shape.height },
        { x: shape.x, y: shape.y + shape.height },
      ];
    case 'ellipse': {
      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;
      const pts: Point[] = [];
      for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
        const a = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
        pts.push({ x: cx + (Math.cos(a) * shape.width) / 2, y: cy + (Math.sin(a) * shape.height) / 2 });
      }
      return pts;
    }
    case 'polygon':
      return shape.points;
  }
}

/** Coverage per pixel for a w×h image (even-odd fill rule). */
export function rasterizeMask(shape: MaskShape, w: number, h: number): Float32Array {
  const mask = new Float32Array(w * h);
  const pts = maskPolygon(shape).map((p) => ({ x: p.x * w, y: p.y * h }));
  if (pts.length < 3) return mask;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  const xs: number[] = [];
  const weight = 1 / SUBSAMPLES;
  for (let y = y0; y <= y1; y++) {
    for (let s = 0; s < SUBSAMPLES; s++) {
      const sy = y + (s + 0.5) / SUBSAMPLES;
      xs.length = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a.y <= sy && b.y > sy) || (b.y <= sy && a.y > sy)) {
          xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) addSpan(mask, y * w, w, xs[i], xs[i + 1], weight);
    }
  }
  for (let i = 0; i < mask.length; i++) if (mask[i] > 1) mask[i] = 1;
  return mask;
}

/** Add coverage for the horizontal span [xa, xb) on one row, with fractional end pixels. */
function addSpan(mask: Float32Array, row: number, w: number, xa: number, xb: number, weight: number) {
  const a = Math.max(0, xa);
  const b = Math.min(w, xb);
  if (b <= a) return;
  const ia = Math.floor(a);
  const ib = Math.floor(b);
  if (ia === ib) {
    mask[row + ia] += (b - a) * weight;
    return;
  }
  mask[row + ia] += (ia + 1 - a) * weight;
  for (let x = ia + 1; x < ib; x++) mask[row + x] += weight;
  if (ib < w) mask[row + ib] += (b - ib) * weight;
}
