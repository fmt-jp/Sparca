import type { Box, Point, SceneObject } from './types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEG = Math.PI / 180;

export function rotatePoint(p: Point, center: Point, degrees: number): Point {
  if (degrees === 0) return p;
  const r = degrees * DEG;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

export function boxCenter(b: Box): Point {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Corners of a box in document coordinates, clockwise from top-left. */
export function boxCorners(b: Box): Point[] {
  const c = boxCenter(b);
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ].map((p) => rotatePoint(p, c, b.rotation));
}

export function boundsOfPoints(points: Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Axis-aligned bounds of an object (groups: union of children). */
export function objectBounds(o: SceneObject): Rect | null {
  if (o.type === 'group') return unionBounds(o.children);
  return boundsOfPoints(boxCorners(o.box));
}

export function unionBounds(objects: SceneObject[]): Rect | null {
  const pts: Point[] = [];
  for (const o of objects) {
    const b = objectBounds(o);
    if (b) pts.push({ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height });
  }
  return pts.length ? boundsOfPoints(pts) : null;
}

/** Convert a document point into the box's unrotated local frame (origin = box top-left). */
export function toLocal(b: Box, p: Point): Point {
  const q = rotatePoint(p, boxCenter(b), -b.rotation);
  return { x: q.x - b.x, y: q.y - b.y };
}

export function pointInBox(b: Box, p: Point, tolerance = 0): boolean {
  const l = toLocal(b, p);
  return (
    l.x >= -tolerance && l.y >= -tolerance && l.x <= b.width + tolerance && l.y <= b.height + tolerance
  );
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/**
 * A transform applied to whole objects (used for groups and multi-selection):
 * scale around a pivot, then rotate around the same pivot, then translate.
 */
export interface ObjectTransform {
  pivot: Point;
  sx: number;
  sy: number;
  rotation: number;
  dx: number;
  dy: number;
}

export const IDENTITY_TRANSFORM: ObjectTransform = {
  pivot: { x: 0, y: 0 },
  sx: 1,
  sy: 1,
  rotation: 0,
  dx: 0,
  dy: 0,
};

export function transformBox(b: Box, t: ObjectTransform): Box {
  const c = boxCenter(b);
  const scaled = { x: t.pivot.x + (c.x - t.pivot.x) * t.sx, y: t.pivot.y + (c.y - t.pivot.y) * t.sy };
  const rotated = rotatePoint(scaled, t.pivot, t.rotation);
  const nc = { x: rotated.x + t.dx, y: rotated.y + t.dy };
  // A rotated box under non-uniform scale becomes a parallelogram; approximate by
  // scaling each local axis by the length of its image.
  const r = b.rotation * DEG;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const w = b.width * Math.hypot(t.sx * cos, t.sy * sin);
  const h = b.height * Math.hypot(t.sx * sin, t.sy * cos);
  return {
    x: nc.x - w / 2,
    y: nc.y - h / 2,
    width: w,
    height: h,
    rotation: normalizeAngle(b.rotation + t.rotation),
  };
}

export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return Math.round(a * 1e6) / 1e6;
}

export function transformObject<T extends SceneObject>(o: T, t: ObjectTransform): T {
  if (o.type === 'group') {
    return { ...o, children: o.children.map((c) => transformObject(c, t)) };
  }
  return { ...o, box: transformBox(o.box, t) };
}

export function translateObject<T extends SceneObject>(o: T, dx: number, dy: number): T {
  return transformObject(o, { ...IDENTITY_TRANSFORM, dx, dy });
}
