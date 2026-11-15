// スマートガイド (2026-11-06, extended 2026-11-10): while objects are dragged, their left /
// center / right (and top / middle / bottom) snap to those of the other objects and of the
// canvas when within a few screen px, and a guide line shows each alignment.
import type { Rect } from './geometry';
import type { Point } from './types';

/** A guide line: vertical (`v`, at x) or horizontal (`h`, at y), running from / to along the other axis. */
export interface GuideLine {
  axis: 'v' | 'h';
  at: number;
  from: number;
  to: number;
}

/** Left, center, right (or top, middle, bottom) of a rect along an axis. */
const stops = (r: Rect, axis: 'v' | 'h') => (axis === 'v' ? [r.x, r.x + r.width / 2, r.x + r.width] : [r.y, r.y + r.height / 2, r.y + r.height]);
/** Its extent along the other axis. */
const span = (r: Rect, axis: 'v' | 'h'): [number, number] => (axis === 'v' ? [r.y, r.y + r.height] : [r.x, r.x + r.width]);

const SAME = 0.01;

/**
 * Snap `moving` (where the drag puts it) to `targets` and the canvas. `tol` is the snapping
 * distance in document px; `free` says per axis whether it may move (Shift locks one).
 * Returns the extra shift and the guide lines to show where edges or centers now meet.
 */
export function snapToGuides(
  moving: Rect,
  targets: Rect[],
  canvas: { width: number; height: number },
  tol: number,
  free: { x: boolean; y: boolean },
): { dx: number; dy: number; lines: GuideLine[] } {
  const page: Rect = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const all = [...targets, page];
  const lines: GuideLine[] = [];
  const shift = { v: 0, h: 0 };
  for (const axis of ['v', 'h'] as const) {
    const ms = stops(moving, axis);
    let best: number | null = null;
    for (const t of all) {
      for (const tv of stops(t, axis)) {
        for (const mv of ms) {
          const d = tv - mv;
          if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best))) best = d;
        }
      }
    }
    if (best !== null && (axis === 'v' ? free.x : free.y)) shift[axis] = best;
  }
  // Every alignment at the snapped position gets a line (merged per position), spanning the
  // moved objects and what they line up with.
  const placed: Rect = { ...moving, x: moving.x + shift.v, y: moving.y + shift.h };
  for (const axis of ['v', 'h'] as const) {
    const ps = stops(placed, axis);
    const [m0, m1] = span(placed, axis);
    const byAt = new Map<number, [number, number]>();
    for (const t of all) {
      const [t0, t1] = span(t, axis);
      for (const tv of stops(t, axis)) {
        if (!ps.some((p) => Math.abs(p - tv) < SAME)) continue;
        const key = Math.round(tv * 100) / 100;
        const cur = byAt.get(key);
        byAt.set(key, [Math.min(m0, t0, cur?.[0] ?? Infinity), Math.max(m1, t1, cur?.[1] ?? -Infinity)]);
      }
    }
    for (const [at, [from, to]] of byAt) lines.push({ axis, at, from, to });
  }
  return { dx: shift.v, dy: shift.h, lines };
}

type Edge = { axis: 'v' | 'h'; max: boolean };
const edgeAt = (r: Rect, e: Edge) => (e.axis === 'v' ? (e.max ? r.x + r.width : r.x) : e.max ? r.y + r.height : r.y);

/**
 * スマートガイド while resizing (2026-11-15, user request): the edges the handle moves snap to
 * the left / center / right (top / middle / bottom) of the other objects and of the canvas.
 * `boxAt` gives the resized (axis-aligned) bounds for a pointer position; the edges it moves
 * are found by probing it, so it works for any handle, from the center (both sides move) and
 * keeping the aspect. Each axis snaps on its own, or — keeping the aspect — only the nearest
 * edge snaps (the other axis follows the ratio). Returns the pointer to use and the guides.
 */
export function snapResize(
  boxAt: (p: Point) => Rect,
  p: Point,
  targets: Rect[],
  canvas: { width: number; height: number },
  tol: number,
  keepAspect: boolean,
): { p: Point; lines: GuideLine[] } {
  const all = [...targets, { x: 0, y: 0, width: canvas.width, height: canvas.height }];
  const r0 = boxAt(p);
  const probes = { x: boxAt({ x: p.x + 1, y: p.y }), y: boxAt({ x: p.x, y: p.y + 1 }) };
  const edges: Edge[] = [];
  for (const axis of ['v', 'h'] as const) {
    for (const max of [false, true]) {
      const e = { axis, max };
      if (Math.abs(edgeAt(probes.x, e) - edgeAt(r0, e)) > 1e-6 || Math.abs(edgeAt(probes.y, e) - edgeAt(r0, e)) > 1e-6) edges.push(e);
    }
  }
  // Candidate pointers: for each moving edge near a stop, the pointer moved along x or y by the
  // amount that brings that edge onto it (the edge moves linearly with the pointer near here).
  type Cand = { axis: 'v' | 'h'; dist: number; q: Point; dir: 'x' | 'y' };
  const cands: Cand[] = [];
  for (const e of edges) {
    const ev = edgeAt(r0, e);
    for (const t of all) {
      for (const tv of stops(t, e.axis)) {
        const d = tv - ev;
        if (Math.abs(d) > tol) continue;
        for (const dir of ['x', 'y'] as const) {
          const slope = edgeAt(probes[dir], e) - ev;
          if (Math.abs(slope) < 1e-6) continue;
          const q = dir === 'x' ? { x: p.x + d / slope, y: p.y } : { x: p.x, y: p.y + d / slope };
          if (Math.abs(edgeAt(boxAt(q), e) - tv) < SAME) cands.push({ axis: e.axis, dist: Math.abs(d), q, dir });
        }
      }
    }
  }
  const nearest = (list: Cand[]) => list.reduce<Cand | null>((b, c) => (!b || c.dist < b.dist ? c : b), null);
  let q = p;
  if (keepAspect) q = nearest(cands)?.q ?? p;
  else {
    const v = nearest(cands.filter((c) => c.axis === 'v' && c.dir === 'x'));
    const h = nearest(cands.filter((c) => c.axis === 'h' && c.dir === 'y'));
    q = { x: v ? v.q.x : p.x, y: h ? h.q.y : p.y };
  }
  // A guide for each moved edge that now meets a stop, spanning the box and what it meets.
  const placed = boxAt(q);
  const lines: GuideLine[] = [];
  for (const axis of ['v', 'h'] as const) {
    const [m0, m1] = span(placed, axis);
    const byAt = new Map<number, [number, number]>();
    for (const e of edges.filter((x) => x.axis === axis)) {
      const ev = edgeAt(placed, e);
      for (const t of all) {
        if (!stops(t, axis).some((tv) => Math.abs(tv - ev) < SAME)) continue;
        const [t0, t1] = span(t, axis);
        const key = Math.round(ev * 100) / 100;
        const cur = byAt.get(key);
        byAt.set(key, [Math.min(m0, t0, cur?.[0] ?? Infinity), Math.max(m1, t1, cur?.[1] ?? -Infinity)]);
      }
    }
    for (const [at, [from, to]] of byAt) lines.push({ axis, at, from, to });
  }
  return { p: q, lines };
}
