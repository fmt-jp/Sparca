// Brush / pencil / eraser strokes (types.ts LocalStroke) drawn into a raster: the stroke's
// coverage is the round-capped band around its path (max over its segments, so a stroke
// crossing itself does not get darker), then painted over (source-over) or erased.
import type { LocalStroke, Point } from '../model/types';
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

/** The raster with the stroke applied. `scale` (≤1) is the preview downscale. */
export function applyStroke(img: Raster, s: LocalStroke, scale = 1): Raster {
  const { width: w, height: h } = img;
  const pencil = s.tool === 'pencil';
  // The pencil goes through pixel centers, so a 1 px line is exactly one pixel wide.
  const at = (v: number) => (pencil ? Math.floor(v) + 0.5 : v);
  const pts = s.points.map((p) => ({ x: at(p.x * w), y: at(p.y * h) }));
  // A 1 px pencil still marks at least the pixel under it.
  const radius = Math.max(pencil ? 0.5 : 0.25, (s.size * scale) / 2);
  const cov = strokeCoverage(pts, w, h, radius, pencil ? 1 : s.hardness, pencil);
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
