// Layout of text along a path (テキストをパスに添付): each character is measured, placed at
// its distance along the path and turned / skewed by the orientation (Fireworks テキストの方向):
// - rotate: turned with the path (the usual "text on a path")
// - vertical: kept upright
// - skew-vertical: its baseline follows the path, its verticals stay vertical
// - skew-horizontal: it stays level, its verticals lean with the path's normal
// Done by hand rather than with SVG <textPath>, which only knows the first one.
import type { PathNode, Point, TextObject } from '../model/types';
import { cssFontFamily } from './fonts';
import { textLines } from './text';

export interface PlacedGlyph {
  char: string;
  /** SVG transform in the text box's px coordinates; the glyph is drawn centered at (0, 0) on its baseline. */
  transform: string;
}

/** Points along the path (px) with the distance from its start, for lookups by length. */
interface Polyline {
  pts: Point[];
  dist: number[];
  length: number;
  closed: boolean;
}

const STEPS = 32;

function bez(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** The path (box-normalized nodes) as a polyline in px of a w × h box, optionally reversed. */
export function pathPolyline(nodes: PathNode[], closed: boolean, w: number, h: number, reverse = false): Polyline {
  const P = (q: Point) => ({ x: q.x * w, y: q.y * h });
  const pts: Point[] = [];
  const n = nodes.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % n];
    const p0 = P(a.anchor);
    const p3 = P(b.anchor);
    const curved = a.out || b.in;
    const p1 = P(a.out ?? a.anchor);
    const p2 = P(b.in ?? b.anchor);
    const steps = curved ? STEPS : 1;
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) pts.push(curved ? bez(p0, p1, p2, p3, k / steps) : k === 0 ? p0 : p3);
  }
  if (reverse) pts.reverse();
  const dist = [0];
  for (let i = 1; i < pts.length; i++) dist.push(dist[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, dist, length: dist[dist.length - 1] ?? 0, closed };
}

/** Point and direction (degrees) at distance `s` along the polyline. */
function at(pl: Polyline, s: number): { p: Point; angle: number } {
  const { pts, dist } = pl;
  let lo = 0;
  let hi = dist.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] <= s) lo = mid;
    else hi = mid;
  }
  // Skip zero-length steps so the direction is defined.
  let j = hi;
  while (j < pts.length - 1 && dist[j] - dist[lo] < 1e-9) j++;
  const a = pts[lo];
  const b = pts[j];
  const segLen = dist[j] - dist[lo] || 1;
  const t = Math.min(1, Math.max(0, (s - dist[lo]) / segLen));
  return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
}

let ctx: CanvasRenderingContext2D | null | undefined;

/** Advance width of each character (without letter spacing). Estimated outside the browser. */
function advances(o: TextObject, chars: string[]): number[] {
  if (ctx === undefined) ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!ctx) return chars.map(() => o.fontSize * 0.6);
  ctx.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.fontSize}px ${cssFontFamily(o.fontFamily)}`;
  return chars.map((c) => ctx!.measureText(c).width);
}

const f = (n: number) => Math.round(n * 1000) / 1000;

/** Text on a path as positioned characters (the text's lines joined by spaces). */
export function layoutTextOnPath(o: TextObject): PlacedGlyph[] {
  const tp = o.path;
  if (!tp) return [];
  const pl = pathPolyline(tp.nodes, tp.closed, o.box.width, o.box.height, tp.reverse);
  if (pl.length <= 0) return [];
  const chars = [...textLines(o.text).join(' ')];
  const adv = advances(o, chars).map((a) => a + o.letterSpacing);
  const total = adv.reduce((s, a) => s + a, 0) - (chars.length ? o.letterSpacing : 0);
  const anchorShare = o.align === 'center' ? 0.5 : o.align === 'right' ? 1 : 0;
  let s = tp.offset * pl.length - total * anchorShare;
  const out: PlacedGlyph[] = [];
  chars.forEach((char, i) => {
    let mid = s + (adv[i] - o.letterSpacing) / 2;
    s += adv[i];
    if (pl.closed) mid = ((mid % pl.length) + pl.length) % pl.length;
    else if (mid < 0 || mid > pl.length) return; // past the ends of an open path
    if (char === ' ') return;
    const { p, angle } = at(pl, mid);
    // Baseline moved off the path along its normal (toward the top of the letters).
    const r = (angle * Math.PI) / 180;
    const q = { x: p.x + Math.sin(r) * tp.shift, y: p.y - Math.cos(r) * tp.shift };
    const base = `translate(${f(q.x)} ${f(q.y)})`;
    const transform =
      tp.orientation === 'rotate'
        ? `${base} rotate(${f(angle)})`
        : tp.orientation === 'vertical'
          ? base
          : tp.orientation === 'skew-vertical'
            ? `${base} skewY(${f(clampSkew(angle))})`
            : `${base} skewX(${f(-clampSkew(angle))})`;
    out.push({ char, transform });
  });
  return out;
}

/** Steepest skew used: beyond this the letters stretch past legibility (tan 60° ≈ 1.7). */
const MAX_SKEW = 60;

/** Skew angle for a path direction, limited to ±MAX_SKEW (a skew is infinite at ±90°). */
function clampSkew(angle: number): number {
  // A path going right-to-left is the same slope as left-to-right for a skew.
  const a = ((((angle + 90) % 180) + 180) % 180) - 90;
  return Math.max(-MAX_SKEW, Math.min(MAX_SKEW, a));
}
