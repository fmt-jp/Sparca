// Tone curves: control points → 256-entry lookup tables (monotone cubic interpolation).
import type { CurveChannel, CurvePoint, Curves } from './types';

export const CURVE_CHANNELS: { channel: CurveChannel; label: string }[] = [
  { channel: 'rgb', label: 'RGB' },
  { channel: 'r', label: '赤' },
  { channel: 'g', label: '緑' },
  { channel: 'b', label: '青' },
];

export const MAX_CURVE_POINTS = 16;

export function identityCurve(): CurvePoint[] {
  return [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ];
}

export function defaultCurves(): Curves {
  return { rgb: identityCurve(), r: identityCurve(), g: identityCurve(), b: identityCurve() };
}

export function isIdentityCurve(points: CurvePoint[]): boolean {
  return points.every((p) => p.x === p.y) && points.length >= 2 && points[0].x === 0 && points[points.length - 1].x === 255;
}

/**
 * Curve value at every level 0..255. Fritsch–Carlson monotone cubic between the points
 * (smooth, but never overshoots between two points, so a gentle S stays gentle); flat
 * beyond the first / last point; clamped to 0..255.
 */
export function sampleCurve(points: CurvePoint[]): Float64Array {
  const p = [...points].sort((a, b) => a.x - b.x);
  const out = new Float64Array(256);
  const n = p.length;
  if (n === 0) {
    for (let v = 0; v < 256; v++) out[v] = v;
    return out;
  }
  if (n === 1) return out.fill(Math.min(255, Math.max(0, p[0].y)));
  // Secant slopes, then tangents limited for monotonicity.
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1].y - p[i].y) / Math.max(1e-9, p[i + 1].x - p[i].x));
  const m: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let seg = 0;
  for (let v = 0; v < 256; v++) {
    let y: number;
    if (v <= p[0].x) y = p[0].y;
    else if (v >= p[n - 1].x) y = p[n - 1].y;
    else {
      while (seg < n - 2 && v > p[seg + 1].x) seg++;
      const h = p[seg + 1].x - p[seg].x;
      const t = (v - p[seg].x) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      y =
        (2 * t3 - 3 * t2 + 1) * p[seg].y +
        (t3 - 2 * t2 + t) * h * m[seg] +
        (-2 * t3 + 3 * t2) * p[seg + 1].y +
        (t3 - t2) * h * m[seg + 1];
    }
    out[v] = Math.min(255, Math.max(0, y));
  }
  return out;
}

/**
 * Final table of one color channel (0..1 values for SVG feFunc tables): the channel's
 * own curve first, then the RGB (composite) curve.
 */
export function channelTable(curves: Curves, channel: 'r' | 'g' | 'b'): number[] {
  const own = sampleCurve(curves[channel]);
  const all = sampleCurve(curves.rgb);
  const out: number[] = [];
  for (let v = 0; v < 256; v++) {
    const x = own[v];
    // Linear between the composite curve's integer levels.
    const i = Math.min(254, Math.floor(x));
    const y = all[i] + (all[i + 1] - all[i]) * (x - i);
    out.push(y / 255);
  }
  return out;
}

/** Insert a point keeping the list sorted; null when x is already taken or the list is full. */
export function addCurvePoint(points: CurvePoint[], pt: CurvePoint): { points: CurvePoint[]; index: number } | null {
  if (points.length >= MAX_CURVE_POINTS || points.some((p) => Math.abs(p.x - pt.x) < 1)) return null;
  const next = [...points, pt].sort((a, b) => a.x - b.x);
  return { points: next, index: next.indexOf(pt) };
}

/** Move point i, keeping it between its neighbors (x) and inside 0..255. */
export function moveCurvePoint(points: CurvePoint[], i: number, x: number, y: number): CurvePoint[] {
  const lo = i > 0 ? points[i - 1].x + 1 : 0;
  const hi = i < points.length - 1 ? points[i + 1].x - 1 : 255;
  const clamp = (v: number, a: number, b: number) => Math.round(Math.min(b, Math.max(a, v)));
  return points.map((p, k) => (k === i ? { x: clamp(x, lo, hi), y: clamp(y, 0, 255) } : p));
}
