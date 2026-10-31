// Math for interactive resize/rotate handles, independent of the UI.
import { boxCenter, rotatePoint, toLocal, type Rect } from './geometry';
import type { Box, Point } from './types';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Handle position as fractions of the box (0..1). */
export function handleFraction(h: Handle): Point {
  return {
    x: h.includes('w') ? 0 : h.includes('e') ? 1 : 0.5,
    y: h.includes('n') ? 0 : h.includes('s') ? 1 : 0.5,
  };
}

export function handlePoint(b: Box, h: Handle): Point {
  const f = handleFraction(h);
  return rotatePoint({ x: b.x + b.width * f.x, y: b.y + b.height * f.y }, boxCenter(b), b.rotation);
}

export interface ResizeOptions {
  keepAspect: boolean;
  fromCenter: boolean;
  minSize?: number;
}

/**
 * Resize a (possibly rotated) box by dragging handle `h` to document point `p`.
 * Works in the box's local frame; the opposite edge stays fixed unless fromCenter.
 */
export function resizeBox(start: Box, h: Handle, p: Point, opt: ResizeOptions): Box {
  const min = opt.minSize ?? 1;
  const l = toLocal(start, p);
  const f = handleFraction(h);
  const movesX = f.x !== 0.5;
  const movesY = f.y !== 0.5;
  let left = 0;
  let top = 0;
  let right = start.width;
  let bottom = start.height;
  if (opt.fromCenter) {
    const cx = start.width / 2;
    const cy = start.height / 2;
    if (movesX) {
      const half = Math.max(min / 2, Math.abs(l.x - cx));
      left = cx - half;
      right = cx + half;
    }
    if (movesY) {
      const half = Math.max(min / 2, Math.abs(l.y - cy));
      top = cy - half;
      bottom = cy + half;
    }
  } else {
    if (f.x === 0) left = Math.min(l.x, right - min);
    if (f.x === 1) right = Math.max(l.x, left + min);
    if (f.y === 0) top = Math.min(l.y, bottom - min);
    if (f.y === 1) bottom = Math.max(l.y, top + min);
  }
  if (opt.keepAspect && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    let w = right - left;
    let hgt = bottom - top;
    if (movesX && movesY) {
      // Corner: follow the dominant axis.
      if (w / ratio > hgt) hgt = w / ratio;
      else w = hgt * ratio;
    } else if (movesX) hgt = w / ratio;
    else w = hgt * ratio;
    const anchor = {
      x: opt.fromCenter ? start.width / 2 : f.x === 0 ? right : f.x === 1 ? left : (left + right) / 2,
      y: opt.fromCenter ? start.height / 2 : f.y === 0 ? bottom : f.y === 1 ? top : (top + bottom) / 2,
    };
    const ax = opt.fromCenter || f.x === 0.5 ? 0.5 : f.x === 0 ? 1 : 0;
    const ay = opt.fromCenter || f.y === 0.5 ? 0.5 : f.y === 0 ? 1 : 0;
    left = anchor.x - w * ax;
    right = left + w;
    top = anchor.y - hgt * ay;
    bottom = top + hgt;
  }
  const w = right - left;
  const hh = bottom - top;
  // New center in document coordinates.
  const localCenter = { x: start.x + left + w / 2, y: start.y + top + hh / 2 };
  const c = rotatePoint(localCenter, boxCenter(start), start.rotation);
  return { x: c.x - w / 2, y: c.y - hh / 2, width: w, height: hh, rotation: start.rotation };
}

/** Scale factors and pivot for resizing an axis-aligned bounds by handle `h` (multi-selection, groups). */
export function boundsResize(
  b: Rect,
  h: Handle,
  p: Point,
  opt: ResizeOptions,
): { pivot: Point; sx: number; sy: number } {
  const next = resizeBox({ ...b, rotation: 0 }, h, p, opt);
  const f = handleFraction(h);
  const pivot = opt.fromCenter
    ? { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    : { x: b.x + b.width * (1 - f.x), y: b.y + b.height * (1 - f.y) };
  return {
    pivot,
    sx: b.width > 0 ? next.width / b.width : 1,
    sy: b.height > 0 ? next.height / b.height : 1,
  };
}

/** Angle in degrees from `center` to `p` (0 = right, clockwise positive). */
export function angleTo(center: Point, p: Point): number {
  return (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;
}

export function snapAngle(deg: number, step = 15): number {
  return Math.round(deg / step) * step;
}

/** Normalize a drag from a to b into a box; shift = square, alt = from center. */
export function dragRect(a: Point, b: Point, square: boolean, fromCenter: boolean): Rect {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (square) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * s;
    dy = Math.sign(dy || 1) * s;
  }
  if (fromCenter) {
    return { x: a.x - Math.abs(dx), y: a.y - Math.abs(dy), width: Math.abs(dx) * 2, height: Math.abs(dy) * 2 };
  }
  return { x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), width: Math.abs(dx), height: Math.abs(dy) };
}

/** Constrain b relative to a to multiples of 45°. */
/**
 * `b` moved onto the nearest line through `a` at a multiple of 45° (horizontal, vertical or
 * diagonal), straight across from where it was (so a horizontal snap keeps b's x).
 */
export function project45(a: Point, b: Point): Point {
  const ang = snapAngle(angleTo(a, b), 45) * (Math.PI / 180);
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const t = (b.x - a.x) * ux + (b.y - a.y) * uy;
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return { x: r(a.x + ux * t), y: r(a.y + uy * t) };
}

export function snap45(a: Point, b: Point): Point {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ang = snapAngle(angleTo(a, b), 45) * (Math.PI / 180);
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}
