// Pure geometry → SVG path data, in the object's local (unrotated) box frame.
import type { PathNode, Point, ShapeGeometry } from '../model/types';

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

export function regularPolygonPoints(sides: number, w: number, h: number): Point[] {
  const n = Math.max(3, Math.round(sides));
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push({ x: w / 2 + (Math.cos(a) * w) / 2, y: h / 2 + (Math.sin(a) * h) / 2 });
  }
  return pts;
}

export function starPoints(points: number, innerRatio: number, w: number, h: number): Point[] {
  const n = Math.max(3, Math.round(points));
  const r = Math.min(0.95, Math.max(0.05, innerRatio));
  const pts: Point[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const k = i % 2 === 0 ? 1 : r;
    pts.push({ x: w / 2 + (Math.cos(a) * w * k) / 2, y: h / 2 + (Math.sin(a) * h * k) / 2 });
  }
  return pts;
}

function polyD(pts: Point[], closed: boolean): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join(' ') + (closed ? ' Z' : '');
}

export function roundedRectD(w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) return `M0 0 H${f(w)} V${f(h)} H0 Z`;
  return [
    `M${f(r)} 0`,
    `H${f(w - r)}`,
    `A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}`,
    `V${f(h - r)}`,
    `A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}`,
    `H${f(r)}`,
    `A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}`,
    `V${f(r)}`,
    `A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0`,
    'Z',
  ].join(' ');
}

export function ellipseD(w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  return `M0 ${f(ry)} A${f(rx)} ${f(ry)} 0 1 0 ${f(w)} ${f(ry)} A${f(rx)} ${f(ry)} 0 1 0 0 ${f(ry)} Z`;
}

/** Arrow head polygon at `to`, pointing away from `from`. Coordinates in px. */
export function arrowHead(from: Point, to: Point, size: number, strokeWidth: number): Point[] {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  const s = Math.max(size, strokeWidth * 2.5);
  const baseX = to.x - ux * s;
  const baseY = to.y - uy * s;
  const half = s * 0.5;
  return [
    { x: to.x, y: to.y },
    { x: baseX - uy * half, y: baseY + ux * half },
    { x: baseX + uy * half, y: baseY - ux * half },
  ];
}

export interface ShapePaths {
  /** Main outline (filled and/or stroked). */
  d: string;
  /** Extra filled path drawn in the stroke color (arrow heads). */
  headD?: string;
  /** Whether the main path is open (line-like: never filled). */
  open: boolean;
}

/** Block arrow outline pointing right: tail at x=0, tip at (w, h/2). */
export function blockArrowPoints(shaft: number, head: number, w: number, h: number): Point[] {
  const sh = Math.min(1, Math.max(0.02, shaft)) * h;
  const hx = w * (1 - Math.min(0.98, Math.max(0.02, head)));
  const y0 = (h - sh) / 2;
  const y1 = y0 + sh;
  return [
    { x: 0, y: y0 },
    { x: hx, y: y0 },
    { x: hx, y: 0 },
    { x: w, y: h / 2 },
    { x: hx, y: h },
    { x: hx, y: y1 },
    { x: 0, y: y1 },
  ];
}

/** Full angle at the arrow tip in degrees, for a head of the given size in px. */
export function arrowTipAngle(headLength: number, headWidth: number): number {
  return (2 * Math.atan(headWidth / 2 / Math.max(1e-6, headLength)) * 180) / Math.PI;
}

/** Head length (fraction of the box width) that gives the requested tip angle. */
export function headForTipAngle(angleDeg: number, w: number, h: number): number {
  const a = (Math.min(170, Math.max(10, angleDeg)) * Math.PI) / 180;
  return Math.min(0.98, Math.max(0.02, h / 2 / Math.tan(a / 2) / w));
}

export function shapePaths(g: ShapeGeometry, w: number, h: number, strokeWidth: number): ShapePaths {
  switch (g.kind) {
    case 'block-arrow':
      return { d: polyD(blockArrowPoints(g.shaft, g.head, w, h), true), open: false };
    case 'rect':
      return { d: roundedRectD(w, h, g.cornerRadius), open: false };
    case 'ellipse':
      return { d: ellipseD(w, h), open: false };
    case 'polygon':
      return { d: polyD(regularPolygonPoints(g.sides, w, h), true), open: false };
    case 'star':
      return { d: polyD(starPoints(g.points, g.innerRatio, w, h), true), open: false };
    case 'line': {
      const a = { x: g.from.x * w, y: g.from.y * h };
      const b = { x: g.to.x * w, y: g.to.y * h };
      return { d: polyD([a, b], false), open: true };
    }
    case 'arrow': {
      const a = { x: g.from.x * w, y: g.from.y * h };
      const b = { x: g.to.x * w, y: g.to.y * h };
      const head = arrowHead(a, b, g.headSize, strokeWidth);
      // Shorten the shaft so a thick line does not poke through the tip.
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const back = Math.min(len, Math.max(g.headSize, strokeWidth * 2.5) * 0.6);
      const shaftEnd = { x: b.x - ((b.x - a.x) / len) * back, y: b.y - ((b.y - a.y) / len) * back };
      return { d: polyD([a, shaftEnd], false), headD: polyD(head, true), open: true };
    }
  }
}

export function pathNodesD(nodes: PathNode[], closed: boolean, w: number, h: number): string {
  if (nodes.length === 0) return '';
  const P = (p: Point) => `${f(p.x * w)} ${f(p.y * h)}`;
  const parts = [`M${P(nodes[0].anchor)}`];
  const seg = (a: PathNode, b: PathNode) => {
    if (!a.out && !b.in) parts.push(`L${P(b.anchor)}`);
    else parts.push(`C${P(a.out ?? a.anchor)} ${P(b.in ?? b.anchor)} ${P(b.anchor)}`);
  };
  for (let i = 1; i < nodes.length; i++) seg(nodes[i - 1], nodes[i]);
  if (closed && nodes.length > 1) {
    seg(nodes[nodes.length - 1], nodes[0]);
    parts.push('Z');
  }
  return parts.join(' ');
}
