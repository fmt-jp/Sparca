// Brush / pencil / eraser strokes (types.ts LocalStroke) drawn into a raster: the stroke's
// coverage is the round-capped band around its path (max over its segments, so a stroke
// crossing itself does not get darker), then painted over (source-over) or erased.
import type { LocalStroke, Point } from '../model/types';
import { rasterizeMask } from './mask';
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
