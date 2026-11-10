// スマートガイド (2026-11-06, extended 2026-11-10): while objects are dragged, their left /
// center / right (and top / middle / bottom) snap to those of the other objects and of the
// canvas when within a few screen px, and a guide line shows each alignment.
import type { Rect } from './geometry';

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
