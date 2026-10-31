// Gradient fills: defaults, stop interpolation and handle geometry (see types.ts Gradient).
import { boxCenter, rotatePoint } from './geometry';
import type { Box, Fill, Gradient, GradientStop, Point, SceneObject } from './types';
import { isPattern } from './pattern';

export const GRADIENT_KINDS: { kind: Gradient['kind']; label: string }[] = [
  { kind: 'linear', label: '線形' },
  { kind: 'radial', label: '放射' },
  { kind: 'conic', label: '円錐' },
];

export function isGradient(f: Fill | null | undefined): f is Gradient {
  return typeof f === 'object' && f !== null && f.kind !== 'pattern';
}

/**
 * Start/end of a newly chosen gradient kind (box-normalized). The handles are kept off
 * the selection's resize handles so both stay easy to grab.
 */
export function defaultGeometry(kind: Gradient['kind']): Pick<Gradient, 'start' | 'end'> {
  if (kind === 'linear') return { start: { x: 0.1, y: 0.5 }, end: { x: 0.9, y: 0.5 } };
  // Radial: the circle just reaches the box edges (radius 0.5) along the diagonal.
  if (kind === 'radial') return { start: { x: 0.5, y: 0.5 }, end: { x: 0.5 + 0.5 / Math.SQRT2, y: 0.5 + 0.5 / Math.SQRT2 } };
  return { start: { x: 0.5, y: 0.5 }, end: { x: 0.8, y: 0.5 } };
}

export type GradientKey = 'fill' | 'stroke' | 'color';

/**
 * The gradient whose handles an object shows: of the fill (of closed shapes/paths) or the
 * text color, or of the stroke. When both fill and stroke are gradients, `prefer` picks.
 */
export function objectGradient(o: SceneObject, prefer: 'fill' | 'stroke' = 'fill'): { gradient: Gradient; key: GradientKey; box: Box } | null {
  if (o.type === 'text') return isGradient(o.color) ? { gradient: o.color, key: 'color', box: o.box } : null;
  if (o.type !== 'path' && o.type !== 'shape') return null;
  const open = o.type === 'path' ? !o.closed : o.shape.kind === 'line' || o.shape.kind === 'arrow';
  const fill = !open && isGradient(o.fill) ? { gradient: o.fill, key: 'fill' as const, box: o.box } : null;
  const stroke = isGradient(o.stroke) && o.strokeWidth > 0 ? { gradient: o.stroke, key: 'stroke' as const, box: o.box } : null;
  return prefer === 'stroke' ? (stroke ?? fill) : (fill ?? stroke);
}

/**
 * A gradient of `kind` derived from the current fill: an existing gradient keeps its
 * colors; a solid color fades to white; no fill starts from white to black.
 */
export function toGradient(kind: Gradient['kind'], current: Fill | null): Gradient {
  if (isGradient(current)) {
    if (current.kind === kind) return current;
    return { ...current, kind, ...defaultGeometry(kind) };
  }
  if (isPattern(current)) current = current.color;
  const from = current ?? '#ffffff';
  const to = current ? '#ffffff' : '#000000';
  return {
    kind,
    ...defaultGeometry(kind),
    stops: [
      { offset: 0, color: from, opacity: 1 },
      { offset: 1, color: to, opacity: 1 },
    ],
  };
}

/** A single color standing in for a fill where only a color works (e.g. the text editor). */
export function representativeColor(f: Fill | null): string | null {
  if (isPattern(f)) return f.color;
  if (!isGradient(f)) return f;
  return sortedStops(f.stops)[0]?.color ?? '#000000';
}

export function sortedStops(stops: GradientStop[]): GradientStop[] {
  return [...stops].sort((a, b) => a.offset - b.offset);
}

function hexRgb(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Color and opacity of the gradient at `offset` (0..1), as SVG/canvas interpolate it. */
export function colorAt(stops: GradientStop[], offset: number): { color: string; opacity: number } {
  const s = sortedStops(stops);
  if (!s.length) return { color: '#000000', opacity: 1 };
  if (offset <= s[0].offset) return { color: s[0].color, opacity: s[0].opacity };
  const last = s[s.length - 1];
  if (offset >= last.offset) return { color: last.color, opacity: last.opacity };
  const i = s.findIndex((st) => st.offset >= offset);
  const a = s[i - 1];
  const b = s[i];
  const t = b.offset === a.offset ? 0 : (offset - a.offset) / (b.offset - a.offset);
  const ca = hexRgb(a.color);
  const cb = hexRgb(b.color);
  return {
    color: rgbHex(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t),
    opacity: a.opacity + (b.opacity - a.opacity) * t,
  };
}

/** CSS color of a stop (with its opacity). */
export function stopCss(s: GradientStop): string {
  const [r, g, b] = hexRgb(s.color);
  return `rgba(${r}, ${g}, ${b}, ${s.opacity})`;
}

/** Left-to-right CSS preview of the stops (for the gradient bar). */
export function stopsCss(stops: GradientStop[]): string {
  return `linear-gradient(to right, ${sortedStops(stops)
    .map((s) => `${stopCss(s)} ${s.offset * 100}%`)
    .join(', ')})`;
}

/** Direction start→end in degrees on screen (0 = right, 90 = down), in the box's own frame. */
export function gradientAngle(g: Gradient, w: number, h: number): number {
  return (Math.atan2((g.end.y - g.start.y) * h, (g.end.x - g.start.x) * w) * 180) / Math.PI;
}

/**
 * Turn the gradient to `deg` keeping its length on screen: linear turns about its
 * midpoint, conic about its center.
 */
export function withAngle(g: Gradient, deg: number, w: number, h: number): Gradient {
  const len = Math.hypot((g.end.x - g.start.x) * w, (g.end.y - g.start.y) * h) || Math.max(w, h) / 2;
  const r = (deg * Math.PI) / 180;
  const dx = (Math.cos(r) * len) / (w || 1);
  const dy = (Math.sin(r) * len) / (h || 1);
  if (g.kind === 'linear') {
    const mx = (g.start.x + g.end.x) / 2;
    const my = (g.start.y + g.end.y) / 2;
    return { ...g, start: { x: mx - dx / 2, y: my - dy / 2 }, end: { x: mx + dx / 2, y: my + dy / 2 } };
  }
  return { ...g, end: { x: g.start.x + dx, y: g.start.y + dy } };
}

/** Reverse the color order. */
export function reversed(g: Gradient): Gradient {
  return { ...g, stops: g.stops.map((s) => ({ ...s, offset: 1 - s.offset })) };
}

/** Box-normalized point → document coordinates (honoring the box rotation). */
export function normalizedToDoc(box: Box, p: Point): Point {
  return rotatePoint({ x: box.x + p.x * box.width, y: box.y + p.y * box.height }, boxCenter(box), box.rotation);
}

/** Document point → box-normalized coordinates. */
export function docToNormalized(box: Box, p: Point): Point {
  const q = rotatePoint(p, boxCenter(box), -box.rotation);
  return { x: (q.x - box.x) / (box.width || 1), y: (q.y - box.y) / (box.height || 1) };
}
