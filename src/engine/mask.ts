// Rasterize a selection mask (image-normalized coordinates) into per-pixel coverage 0..1.
// Scanline fill with 4 vertical sub-samples and exact horizontal span coverage (anti-aliased edges).
import type { MaskEdge, MaskShape, Point } from '../model/types';
import { blurChannel } from './blur';

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

/**
 * Coverage per pixel for a w×h image (even-odd fill rule), with the shape's edge
 * treatment applied. Edge lengths are in px of the full-size image; `scale` (≤1) is the
 * preview downscale, applied to them like to every other pixel-sized parameter.
 */
export function rasterizeMask(shape: MaskShape, w: number, h: number, scale = 1): Float32Array {
  const pts = maskPolygon(shape).map((p) => ({ x: p.x * w, y: p.y * h }));
  return rasterizeEdged(pts, w, h, scaledEdge(shape, scale));
}

/** Edge parameters in output pixels. */
interface Edge {
  grow: number;
  antialias: boolean;
  feather: number;
}

function scaledEdge(e: MaskEdge, scale: number): Edge {
  return { grow: (e.grow ?? 0) * scale, antialias: e.antialias !== false, feather: Math.max(0, (e.feather ?? 0) * scale) };
}

/** Whether the edge changes anything beyond plain anti-aliased coverage. */
export function hasEdgeEffect(e: MaskEdge): boolean {
  return Math.abs(e.grow ?? 0) >= 0.01 || (e.feather ?? 0) > 0 || e.antialias === false;
}

/** Feather `f` px fades the edge out over about ±f px: a gaussian with σ = f/2. */
export const featherSigma = (f: number) => f / 2;

/**
 * Coverage of a polygon (pixel coordinates) on a w×h grid, then grown / shrunk, made hard
 * and feathered. Work happens on a grid padded by the reach of grow and feather, so the
 * selection outside the image still pulls the edge correctly (no false edge at the border).
 */
function rasterizeEdged(pts: Point[], w: number, h: number, edge: Edge): Float32Array {
  const plain = Math.abs(edge.grow) < 0.01 && edge.feather <= 0 && edge.antialias;
  if (plain || pts.length < 3) return fillCoverage(pts, w, h);
  const pad = Math.ceil(Math.abs(edge.grow) + featherSigma(edge.feather) * 3) + 2;
  const pw = w + pad * 2;
  const ph = h + pad * 2;
  let m = fillCoverage(
    pts.map((p) => ({ x: p.x + pad, y: p.y + pad })),
    pw,
    ph,
  );
  if (Math.abs(edge.grow) >= 0.01) m = growCoverage(m, pw, ph, edge.grow);
  if (!edge.antialias) for (let i = 0; i < m.length; i++) m[i] = m[i] >= 0.5 ? 1 : 0;
  if (edge.feather > 0) {
    blurChannel(m, new Float32Array(m.length), pw, ph, featherSigma(edge.feather));
    for (let i = 0; i < m.length; i++) m[i] = Math.min(1, Math.max(0, m[i]));
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) out.set(m.subarray((y + pad) * pw + pad, (y + pad) * pw + pad + w), y * w);
  return out;
}

/** Plain anti-aliased coverage of a polygon given in pixel coordinates. */
function fillCoverage(pts: Point[], w: number, h: number): Float32Array {
  const mask = new Float32Array(w * h);
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

/**
 * Move the edge of a coverage map outwards (`r` > 0) or inwards (`r` < 0) by |r| px, with
 * anti-aliased results. Uses the signed distance to the edge: exact Euclidean distance
 * transforms of the inside / outside pixels, refined by the coverage of edge pixels.
 */
function growCoverage(m: Float32Array, w: number, h: number, r: number): Float32Array {
  const n = w * h;
  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) inside[i] = m[i] >= 0.5 ? 1 : 0;
  // Growing needs distances of outside pixels to the shape, shrinking the reverse.
  const dist = distanceTransform(inside, w, h, r > 0 ? 1 : 0);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = m[i];
    // Signed distance from the pixel center to the edge (negative inside).
    let sd: number;
    if (c > 0 && c < 1) sd = 0.5 - c;
    else if (inside[i]) sd = r > 0 ? -1 : -(Math.sqrt(dist[i]) - 0.5);
    else sd = r > 0 ? Math.sqrt(dist[i]) - 0.5 : 1;
    out[i] = Math.min(1, Math.max(0, r - sd + 0.5));
  }
  return out;
}

const INF = 1e20;

/**
 * Squared Euclidean distance from every pixel to the nearest pixel whose `set` value is
 * `target` (0 for those pixels). Felzenszwalb–Huttenlocher, separable and linear time.
 */
export function distanceTransform(set: Uint8Array, w: number, h: number, target: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = set[i] === target ? 0 : INF;
  const size = Math.max(w, h);
  const f = new Float64Array(size);
  const out = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x];
    edt1d(f, h, out, v, z);
    for (let y = 0; y < h; y++) d[y * w + x] = out[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    edt1d(f, w, out, v, z);
    for (let x = 0; x < w; x++) d[y * w + x] = out[x];
  }
  return d;
}

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Largest side of the grid the selection outline is traced on. */
const OUTLINE_GRID = 512;

/**
 * Outline of a grown / shrunk selection, in the selection's own coordinates: the 50%
 * contour of its coverage. Null when the selection is not grown (the shape itself is the
 * outline then). Feather is left out: it fades the edge symmetrically, so its 50% line is
 * the edge itself (only corners would round slightly), and skipping it keeps this cheap.
 */
export function edgeOutline(shape: MaskShape): Point[][] | null {
  if (Math.abs(shape.grow ?? 0) < 0.01) return null;
  const poly = maskPolygon(shape);
  if (poly.length < 3) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const reach = Math.max(0, shape.grow ?? 0) + 1;
  const ox = minX - reach;
  const oy = minY - reach;
  const k = Math.min(1, OUTLINE_GRID / Math.max(maxX - minX + reach * 2, maxY - minY + reach * 2, 1));
  const w = Math.max(1, Math.ceil((maxX - minX + reach * 2) * k));
  const h = Math.max(1, Math.ceil((maxY - minY + reach * 2) * k));
  const pts = poly.map((p) => ({ x: (p.x - ox) * k, y: (p.y - oy) * k }));
  const m = rasterizeEdged(pts, w, h, { grow: (shape.grow ?? 0) * k, antialias: true, feather: 0 });
  return contours(m, w, h, 0.5).map((line) => line.map((p) => ({ x: ox + p.x / k, y: oy + p.y / k })));
}

/**
 * Iso-lines of a w×h field at `level` (marching squares, linear interpolation), as closed
 * polylines in pixel coordinates (pixel centers at i + 0.5). The field counts as 0 outside.
 */
export function contours(m: Float32Array, w: number, h: number, level: number): Point[][] {
  const val = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]);
  // Edge points keyed by the grid edge they lie on; each cell adds segments between them.
  const points = new Map<string, Point>();
  const links = new Map<string, string[]>();
  const point = (key: string, ax: number, ay: number, bx: number, by: number) => {
    if (!points.has(key)) {
      const va = val(ax, ay);
      const vb = val(bx, by);
      const t = vb === va ? 0.5 : (level - va) / (vb - va);
      points.set(key, { x: ax + 0.5 + (bx - ax) * t, y: ay + 0.5 + (by - ay) * t });
    }
    return key;
  };
  const link = (a: string, b: string) => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const a = val(x, y) >= level ? 1 : 0;
      const b = val(x + 1, y) >= level ? 1 : 0;
      const c = val(x + 1, y + 1) >= level ? 1 : 0;
      const d = val(x, y + 1) >= level ? 1 : 0;
      const idx = a | (b << 1) | (c << 2) | (d << 3);
      if (idx === 0 || idx === 15) continue;
      const top = () => point(`h${x},${y}`, x, y, x + 1, y);
      const right = () => point(`v${x + 1},${y}`, x + 1, y, x + 1, y + 1);
      const bottom = () => point(`h${x},${y + 1}`, x, y + 1, x + 1, y + 1);
      const left = () => point(`v${x},${y}`, x, y, x, y + 1);
      switch (idx) {
        case 1: case 14: link(left(), top()); break;
        case 2: case 13: link(top(), right()); break;
        case 3: case 12: link(left(), right()); break;
        case 4: case 11: link(right(), bottom()); break;
        case 6: case 9: link(top(), bottom()); break;
        case 7: case 8: link(left(), bottom()); break;
        case 5:
        case 10: {
          // Saddle: the center value decides which corners are connected.
          const center = (val(x, y) + val(x + 1, y) + val(x + 1, y + 1) + val(x, y + 1)) / 4 >= level;
          if ((idx === 5) === center) {
            link(left(), bottom());
            link(top(), right());
          } else {
            link(left(), top());
            link(right(), bottom());
          }
          break;
        }
      }
    }
  }
  const lines: Point[][] = [];
  const used = new Set<string>();
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    const line: Point[] = [];
    let prev = '';
    let cur: string | undefined = start;
    while (cur && !used.has(cur)) {
      used.add(cur);
      line.push(points.get(cur)!);
      const next: string | undefined = links.get(cur)!.find((n) => n !== prev && !used.has(n));
      prev = cur;
      cur = next;
    }
    if (line.length >= 3) lines.push(line);
  }
  return lines;
}
