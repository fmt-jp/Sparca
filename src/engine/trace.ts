// Outlines of a coverage image (marching squares): used to outline text when the font file
// cannot be read (2026-11-14). Edges are placed between pixels by linear interpolation of the
// coverage, then thinned with Douglas–Peucker. Loops come back as closed point lists in pixel
// coordinates; holes are separate loops, so they fill correctly with the even-odd rule.
import type { Point } from '../model/types';

/**
 * Closed outlines where `values` (w×h, 0..255) crosses `threshold`. Pixel (x, y) is sampled
 * at its center (x + 0.5, y + 0.5). Loops with an area under `minArea` px² are dropped.
 */
export function traceOutlines(values: ArrayLike<number>, w: number, h: number, threshold = 128, tolerance = 0.3, minArea = 1): Point[][] {
  // One empty pixel all round, so every outline closes.
  const W = w + 2;
  const H = h + 2;
  const v = (x: number, y: number) => (x < 1 || y < 1 || x > w || y > h ? 0 : values[(y - 1) * w + (x - 1)]);
  const at = new Map<string, Point>();
  // Crossing point on the edge between two grid samples (keys name the edge).
  const crossing = (key: string, x0: number, y0: number, x1: number, y1: number): string => {
    if (!at.has(key)) {
      const a = v(x0, y0);
      const b = v(x1, y1);
      const t = a === b ? 0.5 : (threshold - a) / (b - a);
      // Grid sample (x, y) is pixel (x − 1, y − 1)'s center: (x − 0.5, y − 0.5).
      at.set(key, { x: x0 + (x1 - x0) * t - 0.5, y: y0 + (y1 - y0) * t - 0.5 });
    }
    return key;
  };
  const next = new Map<string, string>();
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = v(x, y) >= threshold ? 1 : 0;
      const tr = v(x + 1, y) >= threshold ? 1 : 0;
      const br = v(x + 1, y + 1) >= threshold ? 1 : 0;
      const bl = v(x, y + 1) >= threshold ? 1 : 0;
      const c = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (c === 0 || c === 15) continue;
      const T = () => crossing(`h${x},${y}`, x, y, x + 1, y);
      const R = () => crossing(`v${x + 1},${y}`, x + 1, y, x + 1, y + 1);
      const B = () => crossing(`h${x},${y + 1}`, x, y + 1, x + 1, y + 1);
      const L = () => crossing(`v${x},${y}`, x, y, x, y + 1);
      // Segments oriented with the inside on the right, so each edge has one successor.
      const seg = (a: string, b: string) => next.set(a, b);
      const center = (v(x, y) + v(x + 1, y) + v(x + 1, y + 1) + v(x, y + 1)) / 4 >= threshold;
      switch (c) {
        case 1: seg(L(), B()); break;
        case 2: seg(B(), R()); break;
        case 3: seg(L(), R()); break;
        case 4: seg(R(), T()); break;
        case 5:
          if (center) { seg(L(), T()); seg(R(), B()); } else { seg(L(), B()); seg(R(), T()); }
          break;
        case 6: seg(B(), T()); break;
        case 7: seg(L(), T()); break;
        case 8: seg(T(), L()); break;
        case 9: seg(T(), B()); break;
        case 10:
          if (center) { seg(T(), R()); seg(B(), L()); } else { seg(T(), L()); seg(B(), R()); }
          break;
        case 11: seg(T(), R()); break;
        case 12: seg(R(), L()); break;
        case 13: seg(R(), B()); break;
        case 14: seg(B(), L()); break;
      }
    }
  }
  const loops: Point[][] = [];
  const seen = new Set<string>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: Point[] = [];
    let k: string | undefined = start;
    while (k !== undefined && !seen.has(k)) {
      seen.add(k);
      loop.push(at.get(k)!);
      k = next.get(k);
    }
    if (loop.length < 3) continue;
    const simple = simplifyLoop(loop, tolerance);
    if (simple.length >= 3 && Math.abs(area(simple)) >= minArea) loops.push(simple);
  }
  return loops;
}

/** Signed area (shoelace). */
export function area(p: Point[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function perpendicular(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

function dp(pts: Point[], tol: number, from: number, to: number, keep: boolean[]): void {
  let worst = -1;
  let at = -1;
  for (let i = from + 1; i < to; i++) {
    const d = perpendicular(pts[i], pts[from], pts[to]);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst > tol) {
    keep[at] = true;
    dp(pts, tol, from, at, keep);
    dp(pts, tol, at, to, keep);
  }
}

/** Douglas–Peucker on a closed loop: split at the point farthest from the first one. */
export function simplifyLoop(loop: Point[], tol: number): Point[] {
  if (loop.length <= 4) return loop;
  let far = 0;
  let best = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i].x - loop[0].x, loop[i].y - loop[0].y);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const pts = [...loop, loop[0]];
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[far] = keep[pts.length - 1] = true;
  dp(pts, tol, 0, far, keep);
  dp(pts, tol, far, pts.length - 1, keep);
  return loop.filter((_, i) => keep[i]);
}
