// Brush / pencil / eraser strokes (types.ts LocalStroke) drawn into a raster: the stroke's
// coverage is the round-capped band around its path (max over its segments, so a stroke
// crossing itself does not get darker), then painted over (source-over) or erased.
import type { LocalStroke, Point } from '../model/types';
import { gaussianBlur } from './blur';
import { rasterizeMask } from './mask';
import { cropRaster } from './raster';
import type { Raster } from './raster';

/** Coverage 0..1 per pixel of a w×h image for a stroke of `radius` px along `pts` (pixel coordinates). */
export function strokeCoverage(pts: Point[], w: number, h: number, radius: number, hardness: number, aliased: boolean): Float32Array {
  const cov = new Float32Array(w * h);
  if (!pts.length || radius <= 0) return cov;
  const r = radius;
  const inner = r * Math.min(1, Math.max(0, hardness));
  const segs = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((p, i) => [pts[i], p]);
  for (const [a, b] of segs) {
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - r - 1));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + r + 1));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - r - 1));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + r + 1));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
        const d = Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
        let c: number;
        if (aliased) c = d <= r ? 1 : 0;
        else {
          // Anti-aliased edge, faded from `inner` outwards when soft.
          c = Math.min(1, Math.max(0, r + 0.5 - d));
          if (d > inner && r > inner) {
            const u = Math.min(1, (d - inner) / (r - inner));
            c = Math.min(c, 1 - u * u * (3 - 2 * u));
          }
        }
        const i = y * w + x;
        if (c > cov[i]) cov[i] = c;
      }
    }
  }
  return cov;
}

function hexRgb(c: string): [number, number, number] {
  const n = parseInt(c.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Coverage of a pencil line (no anti-aliasing): Bresenham's line between the pixels the points
 * fall in, so it is one pixel thick at any angle (a distance test doubles pixels where a
 * diagonal passes between two centers; user report 2026-11-10). Wider pencils stamp a hard
 * disk of `size` px on each of those pixels.
 */
export function pencilCoverage(pts: Point[], w: number, h: number, size: number): Float32Array {
  const cov = new Float32Array(w * h);
  if (!pts.length) return cov;
  // Offsets of a hard disk of diameter `size` around a pixel (just the pixel at size ≤ 1).
  const r = size / 2;
  const disk: [number, number][] = [];
  const n = Math.ceil(r);
  for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) if (size <= 1 ? dx === 0 && dy === 0 : Math.hypot(dx, dy) <= r) disk.push([dx, dy]);
  const plot = (x: number, y: number) => {
    for (const [dx, dy] of disk) {
      const px = x + dx;
      const py = y + dy;
      if (px >= 0 && py >= 0 && px < w && py < h) cov[py * w + px] = 1;
    }
  };
  const cells = pts.map((p) => ({ x: Math.floor(p.x), y: Math.floor(p.y) }));
  plot(cells[0].x, cells[0].y);
  for (let i = 1; i < cells.length; i++) {
    let { x, y } = cells[i - 1];
    const { x: x1, y: y1 } = cells[i];
    const dx = Math.abs(x1 - x);
    const dy = -Math.abs(y1 - y);
    const sx = x < x1 ? 1 : -1;
    const sy = y < y1 ? 1 : -1;
    let err = dx + dy;
    while (x !== x1 || y !== y1) {
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
      plot(x, y);
    }
  }
  return cov;
}

/** The raster with the stroke applied. `scale` (≤1) is the preview downscale. */
export function applyStroke(img: Raster, s: LocalStroke, scale = 1): Raster {
  const { width: w, height: h } = img;
  const pts = s.points.map((p) => ({ x: p.x * w, y: p.y * h }));
  const cov =
    s.tool === 'pencil'
      ? pencilCoverage(pts, w, h, s.size * scale)
      : strokeCoverage(pts, w, h, Math.max(0.25, (s.size * scale) / 2), s.hardness, false);
  // Drawn while a pixel selection was active: only inside it (its soft edge fades the stroke).
  if (s.clip) {
    const m = rasterizeMask(s.clip, w, h, scale);
    for (let i = 0; i < cov.length; i++) cov[i] *= m[i];
  }
  if (RETOUCH.has(s.tool)) return retouch(img, s, cov, scale);
  const out = new Uint8ClampedArray(img.data);
  const k = Math.min(1, Math.max(0, s.opacity));
  if (s.tool === 'eraser') {
    for (let i = 0; i < cov.length; i++) if (cov[i] > 0) out[i * 4 + 3] = Math.round(out[i * 4 + 3] * (1 - cov[i] * k));
    return { width: w, height: h, data: out };
  }
  const [cr, cg, cb] = hexRgb(s.color);
  for (let i = 0; i < cov.length; i++) {
    const a = cov[i] * k;
    if (a <= 0) continue;
    const j = i * 4;
    const da = out[j + 3] / 255;
    const oa = a + da * (1 - a);
    out[j] = Math.round((cr * a + out[j] * da * (1 - a)) / oa);
    out[j + 1] = Math.round((cg * a + out[j + 1] * da * (1 - a)) / oa);
    out[j + 2] = Math.round((cb * a + out[j + 2] * da * (1 - a)) / oa);
    out[j + 3] = Math.round(oa * 255);
  }
  return { width: w, height: h, data: out };
}

const RETOUCH = new Set(['clone', 'blur', 'sharpen', 'dodge', 'burn']);

/** Bounds (pixels) where the coverage is non-zero, widened by `pad`; null when empty. */
function coverageBounds(cov: Float32Array, w: number, h: number, pad: number): { x: number; y: number; width: number; height: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cov[y * w + x] <= 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** How much 覆い焼き・焼き込み acts on a tone (0..1 luminance) for its range. */
export function toneWeight(l: number, range: string | undefined): number {
  if (range === 'shadows') return (1 - l) * (1 - l);
  if (range === 'highlights') return l * l;
  return 4 * l * (1 - l);
}

/**
 * Retouch strokes (2026-11-11), each blending a changed copy of the image into it by the
 * stroke's coverage × strength:
 * - clone: the pixels `offset` away (as they are before this stroke; none from outside the image)
 * - blur / sharpen: a gaussian blur, or an unsharp mask, of the area under the stroke
 * - dodge / burn: lighter / darker, weighted towards the chosen tones
 */
function retouch(img: Raster, s: LocalStroke, cov: Float32Array, scale: number): Raster {
  const { width: w, height: h, data: src } = img;
  const out = new Uint8ClampedArray(src);
  const k = Math.min(1, Math.max(0, s.opacity));
  if (s.tool === 'clone') {
    const ox = Math.round((s.offset?.x ?? 0) * w);
    const oy = Math.round((s.offset?.y ?? 0) * h);
    for (let y = 0; y < h; y++) {
      const sy = y + oy;
      if (sy < 0 || sy >= h) continue;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const a = cov[i] * k;
        const sx = x + ox;
        if (a <= 0 || sx < 0 || sx >= w) continue;
        const d = i * 4;
        const f = (sy * w + sx) * 4;
        // Blend premultiplied, so transparent source pixels do not darken.
        const da = src[d + 3] / 255;
        const fa = src[f + 3] / 255;
        const oa = da + (fa - da) * a;
        out[d + 3] = Math.round(oa * 255);
        for (let c = 0; c < 3; c++) {
          const v = src[d + c] * da + (src[f + c] * fa - src[d + c] * da) * a;
          out[d + c] = oa > 0 ? Math.round(v / oa) : src[d + c];
        }
      }
    }
    return { width: w, height: h, data: out };
  }
  if (s.tool === 'blur' || s.tool === 'sharpen') {
    // Work on the area under the stroke (plus the blur's reach) only.
    const sigma = Math.max(0.5, (s.size * scale) / 8);
    const box = coverageBounds(cov, w, h, Math.ceil(sigma * 3) + 1);
    if (!box) return img;
    const part = cropRaster(img, box.x, box.y, box.width, box.height);
    const blurred = gaussianBlur(part, sigma);
    for (let y = 0; y < box.height; y++) {
      for (let x = 0; x < box.width; x++) {
        const i = (box.y + y) * w + box.x + x;
        const a = cov[i] * k;
        if (a <= 0) continue;
        const d = i * 4;
        const b = (y * box.width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const target = s.tool === 'blur' ? blurred.data[b + c] : src[d + c] + (src[d + c] - blurred.data[b + c]) * 1.5;
          out[d + c] = Math.round(src[d + c] + (target - src[d + c]) * a);
        }
        if (s.tool === 'blur') out[d + 3] = Math.round(src[d + 3] + (blurred.data[b + 3] - src[d + 3]) * a);
      }
    }
    return { width: w, height: h, data: out };
  }
  // dodge / burn
  const dodge = s.tool === 'dodge';
  for (let i = 0; i < cov.length; i++) {
    const a = cov[i] * k;
    if (a <= 0) continue;
    const d = i * 4;
    const l = (0.299 * src[d] + 0.587 * src[d + 1] + 0.114 * src[d + 2]) / 255;
    const t = a * 0.5 * toneWeight(l, s.range);
    for (let c = 0; c < 3; c++) out[d + c] = Math.round(dodge ? src[d + c] + (255 - src[d + c]) * t : src[d + c] * (1 - t));
  }
  return { width: w, height: h, data: out };
}
