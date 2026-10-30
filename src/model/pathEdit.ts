// Editing of bezier paths (anchor/handle level). Paths store nodes normalized to their
// (possibly rotated) box; editing happens on document-space copies and is converted back,
// re-fitting the box while keeping the rotation and the on-screen position.
import { boxCenter, rotatePoint } from './geometry';
import type { Box, PathContour, PathNode, PathObject, Point } from './types';

/** Node in document coordinates. Handles are null for corner sides. */
export interface DocNode {
  anchor: Point;
  in: Point | null;
  out: Point | null;
}

function toDocPoint(b: Box, n: Point): Point {
  return rotatePoint({ x: b.x + n.x * b.width, y: b.y + n.y * b.height }, boxCenter(b), b.rotation);
}

export function pathToDoc(p: Pick<PathObject, 'box' | 'nodes'>): DocNode[] {
  const t = (q: Point | null) => (q ? toDocPoint(p.box, q) : null);
  return p.nodes.map((n) => ({ anchor: t(n.anchor)!, in: t(n.in), out: t(n.out) }));
}

/** An outline in document coordinates. */
export interface DocContour {
  nodes: DocNode[];
  closed: boolean;
}

/** All outlines of a (compound) path: the main one first, then `subpaths`. */
export function pathContours(p: Pick<PathObject, 'nodes' | 'closed' | 'subpaths'>): PathContour[] {
  return [{ nodes: p.nodes, closed: p.closed }, ...(p.subpaths ?? [])];
}

export function pathContoursToDoc(p: Pick<PathObject, 'box' | 'nodes' | 'closed' | 'subpaths'>): DocContour[] {
  return pathContours(p).map((c) => ({ nodes: pathToDoc({ box: p.box, nodes: c.nodes }), closed: c.closed }));
}

/**
 * All outlines' anchors in one list (outline after outline), as the subselect tool shows
 * them: anchor indices are global across outlines. `contours` says where each outline's
 * anchors start, how many there are and whether it is closed.
 */
export interface FlatPath {
  nodes: DocNode[];
  contours: { start: number; length: number; closed: boolean }[];
}

export function flattenContours(cs: DocContour[]): FlatPath {
  const contours: FlatPath['contours'] = [];
  let start = 0;
  for (const c of cs) {
    contours.push({ start, length: c.nodes.length, closed: c.closed });
    start += c.nodes.length;
  }
  return { nodes: cs.flatMap((c) => c.nodes), contours };
}

/** Outlines again from a flat list with the same outline lengths. */
export function unflattenContours(flat: FlatPath, nodes: DocNode[]): DocContour[] {
  return flat.contours.map((c) => ({ nodes: nodes.slice(c.start, c.start + c.length), closed: c.closed }));
}

/** Which outline a global anchor index is on, and its index there. */
export function locateNode(flat: FlatPath, g: number): { contour: number; index: number } {
  const k = flat.contours.findIndex((c) => g >= c.start && g < c.start + c.length);
  return k < 0 ? { contour: 0, index: g } : { contour: k, index: g - flat.contours[k].start };
}

/** Closest point on any outline: the outline, its segment and parameter, and the distance. */
export function nearestOnFlat(flat: FlatPath, p: Point): { contour: number; segment: number; t: number; dist: number } | null {
  let best: { contour: number; segment: number; t: number; dist: number } | null = null;
  unflattenContours(flat, flat.nodes).forEach((c, k) => {
    const r = nearestOnPath(c.nodes, c.closed, p);
    if (r && (!best || r.dist < best.dist)) best = { contour: k, ...r };
  });
  return best;
}

/**
 * Document-space outlines back into a path's box (same rotation as `prev`, refitted around
 * all outlines) and its `nodes` / `closed` / `subpaths`.
 */
export function docContoursToPath(prev: Box, contours: DocContour[]): Pick<PathObject, 'box' | 'nodes' | 'closed' | 'subpaths'> {
  const fit = docToPath(prev, contours.flatMap((c) => c.nodes));
  const split: PathContour[] = [];
  let at = 0;
  for (const c of contours) {
    split.push({ nodes: fit.nodes.slice(at, at + c.nodes.length), closed: c.closed });
    at += c.nodes.length;
  }
  return { box: fit.box, nodes: split[0].nodes, closed: split[0].closed, subpaths: split.length > 1 ? split.slice(1) : undefined };
}

/**
 * Convert document-space nodes back into a box (same rotation as `prev`) and
 * box-normalized nodes.
 */
export function docToPath(prev: Box, nodes: DocNode[]): { box: Box; nodes: PathNode[] } {
  const c = boxCenter(prev);
  // Points in the unrotated frame of the previous box.
  const local = (q: Point) => {
    const r = rotatePoint(q, c, -prev.rotation);
    return { x: r.x - prev.x, y: r.y - prev.y };
  };
  const pts = nodes.flatMap((n) => [n.anchor, n.in, n.out].filter((q): q is Point => !!q)).map(local);
  const x0 = Math.min(...pts.map((q) => q.x));
  const y0 = Math.min(...pts.map((q) => q.y));
  const w = Math.max(1, Math.max(...pts.map((q) => q.x)) - x0);
  const h = Math.max(1, Math.max(...pts.map((q) => q.y)) - y0);
  // The new box's center, mapped through the previous box's transform.
  const nc = rotatePoint({ x: prev.x + x0 + w / 2, y: prev.y + y0 + h / 2 }, c, prev.rotation);
  const box: Box = { x: nc.x - w / 2, y: nc.y - h / 2, width: w, height: h, rotation: prev.rotation };
  const norm = (q: Point | null) => {
    if (!q) return null;
    const l = local(q);
    return { x: (l.x - x0) / w, y: (l.y - y0) / h };
  };
  return { box, nodes: nodes.map((n) => ({ anchor: norm(n.anchor)!, in: norm(n.in), out: norm(n.out) })) };
}

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const len = (v: Point) => Math.hypot(v.x, v.y);

/** Move anchors (with their handles) by (dx, dy). */
export function moveAnchors(nodes: DocNode[], indices: number[], dx: number, dy: number): DocNode[] {
  const d = { x: dx, y: dy };
  const set = new Set(indices);
  return nodes.map((n, i) =>
    set.has(i) ? { anchor: add(n.anchor, d), in: n.in && add(n.in, d), out: n.out && add(n.out, d) } : n,
  );
}

/** A node is smooth when both handles exist and point in opposite directions. */
export function isSmooth(n: DocNode, toleranceDeg = 2): boolean {
  if (!n.in || !n.out) return false;
  const a = sub(n.in, n.anchor);
  const b = sub(n.out, n.anchor);
  if (len(a) < 1e-6 || len(b) < 1e-6) return false;
  const cos = (a.x * b.x + a.y * b.y) / (len(a) * len(b));
  return cos < -Math.cos((toleranceDeg * Math.PI) / 180);
}

/**
 * Move one handle to `p`. On a smooth node the opposite handle turns with it
 * (keeping its own length) unless `independent` is set, which makes it a corner.
 */
export function moveHandle(nodes: DocNode[], i: number, which: 'in' | 'out', p: Point, independent: boolean): DocNode[] {
  const n = nodes[i];
  const other = which === 'in' ? 'out' : 'in';
  const next: DocNode = { ...n, [which]: p };
  const opp = n[other];
  if (!independent && opp && isSmooth(n)) {
    const v = sub(p, n.anchor);
    const l = len(v);
    if (l > 1e-6) {
      const ol = len(sub(opp, n.anchor));
      next[other] = { x: n.anchor.x - (v.x / l) * ol, y: n.anchor.y - (v.y / l) * ol };
    }
  }
  return nodes.map((m, k) => (k === i ? next : m));
}

/** Turn a node into a corner (no handles). */
export function makeCorner(nodes: DocNode[], i: number): DocNode[] {
  return nodes.map((n, k) => (k === i ? { anchor: n.anchor, in: null, out: null } : n));
}

/**
 * Turn a node into a smooth point: handles along the direction from the previous to the
 * next anchor, each a third of the distance to its neighbor.
 */
export function makeSmooth(nodes: DocNode[], i: number, closed: boolean): DocNode[] {
  const n = nodes[i];
  const prev = nodes[i - 1] ?? (closed ? nodes[nodes.length - 1] : null);
  const next = nodes[i + 1] ?? (closed ? nodes[0] : null);
  const pa = prev?.anchor ?? sub(n.anchor, sub(next!.anchor, n.anchor));
  const na = next?.anchor ?? add(n.anchor, sub(n.anchor, prev!.anchor));
  const dir = sub(na, pa);
  const l = len(dir) || 1;
  const u = { x: dir.x / l, y: dir.y / l };
  const inLen = len(sub(n.anchor, pa)) / 3;
  const outLen = len(sub(na, n.anchor)) / 3;
  const smooth: DocNode = {
    anchor: n.anchor,
    in: { x: n.anchor.x - u.x * inLen, y: n.anchor.y - u.y * inLen },
    out: { x: n.anchor.x + u.x * outLen, y: n.anchor.y + u.y * outLen },
  };
  return nodes.map((m, k) => (k === i ? smooth : m));
}

/** Remove anchors. Returns null when fewer than two anchors would remain. */
export function deleteAnchors(nodes: DocNode[], indices: number[]): DocNode[] | null {
  const set = new Set(indices);
  const rest = nodes.filter((_, i) => !set.has(i));
  return rest.length >= 2 ? rest : null;
}

/** Control points of segment i (from node i to node i+1, wrapping when closed). */
export function segmentPoints(nodes: DocNode[], i: number): [Point, Point, Point, Point] {
  const a = nodes[i];
  const b = nodes[(i + 1) % nodes.length];
  return [a.anchor, a.out ?? a.anchor, b.in ?? b.anchor, b.anchor];
}

export function segmentCount(nodes: DocNode[], closed: boolean): number {
  return closed ? nodes.length : nodes.length - 1;
}

export function bezierPoint([p0, p1, p2, p3]: [Point, Point, Point, Point], t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Closest point on the path to `p` (sampled, then refined). */
export function nearestOnPath(nodes: DocNode[], closed: boolean, p: Point): { segment: number; t: number; dist: number } | null {
  let best: { segment: number; t: number; dist: number } | null = null;
  const SAMPLES = 64;
  for (let s = 0; s < segmentCount(nodes, closed); s++) {
    const seg = segmentPoints(nodes, s);
    for (let k = 0; k <= SAMPLES; k++) {
      const t = k / SAMPLES;
      const d = len(sub(bezierPoint(seg, t), p));
      if (!best || d < best.dist) best = { segment: s, t, dist: d };
    }
  }
  if (!best) return null;
  // Refine around the best sample.
  const seg = segmentPoints(nodes, best.segment);
  let lo = Math.max(0, best.t - 1 / SAMPLES);
  let hi = Math.min(1, best.t + 1 / SAMPLES);
  for (let k = 0; k < 20; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (len(sub(bezierPoint(seg, m1), p)) < len(sub(bezierPoint(seg, m2), p))) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  return { segment: best.segment, t, dist: len(sub(bezierPoint(seg, t), p)) };
}

/**
 * Insert an anchor on segment `segment` at parameter t without changing the curve's shape
 * (de Casteljau subdivision). Straight segments stay straight. Returns the new nodes and
 * the index of the inserted anchor.
 */
export function splitSegment(nodes: DocNode[], segment: number, t: number): { nodes: DocNode[]; index: number } {
  const ia = segment;
  const ib = (segment + 1) % nodes.length;
  const a = nodes[ia];
  const b = nodes[ib];
  const index = segment + 1;
  if (!a.out && !b.in) {
    // `t` is the Bézier parameter (as from nearestOnPath), which is not linear along a
    // handle-less segment, so evaluate the curve rather than lerping the anchors.
    const mid: DocNode = { anchor: bezierPoint(segmentPoints(nodes, segment), t), in: null, out: null };
    const out = [...nodes];
    out.splice(index, 0, mid);
    return { nodes: out, index };
  }
  const [p0, p1, p2, p3] = segmentPoints(nodes, segment);
  const p01 = lerp(p0, p1, t);
  const p12 = lerp(p1, p2, t);
  const p23 = lerp(p2, p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const m = lerp(p012, p123, t);
  const out = nodes.map((n) => ({ ...n }));
  out[ia] = { ...a, out: p01 };
  out[ib] = { ...b, in: p23 };
  out.splice(index, 0, { anchor: m, in: p012, out: p123 });
  return { nodes: out, index };
}
