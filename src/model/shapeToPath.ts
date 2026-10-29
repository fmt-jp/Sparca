// 「パスに変換」: a shape as an equivalent editable path (anchors and Bézier handles), so the
// subselect tool can reshape it. The path keeps the shape's box, so it looks exactly the same
// (paint, gradient, effects and rotation included); the shape's own parameters (corner radius,
// number of sides, …) are gone afterwards.
import { blockArrowPoints, regularPolygonPoints, starPoints } from '../render/shapes';
import type { PathNode, PathObject, Point, ShapeGeometry, ShapeObject } from './types';

/**
 * Handle length for a quarter circle drawn as one cubic Bézier, as a fraction of the radius
 * (4/3·(√2 − 1)); off by at most 0.03 % of the radius.
 */
const KAPPA = 0.5522847498;

/** Whether a shape of this kind can be converted (the old line-with-arrow-head cannot). */
export function canConvertToPath(g: ShapeGeometry): boolean {
  return g.kind !== 'arrow';
}

const corner = (p: Point): PathNode => ({ anchor: p, in: null, out: null });

/**
 * Nodes of the shape's outline in box-normalized coordinates (0..1), for a box of w × h px
 * (needed because corner radii are in px). Null for shapes that cannot be converted.
 */
export function shapeToPathNodes(g: ShapeGeometry, w: number, h: number): { nodes: PathNode[]; closed: boolean } | null {
  const norm = (p: Point): Point => ({ x: p.x / w, y: p.y / h });
  switch (g.kind) {
    case 'rect':
      return { nodes: roundedRectNodes(w, h, g.cornerRadius), closed: true };
    case 'ellipse': {
      // Top, right, bottom, left; handles along the tangents, clockwise.
      const k = KAPPA / 2;
      return {
        closed: true,
        nodes: [
          { anchor: { x: 0.5, y: 0 }, in: { x: 0.5 - k, y: 0 }, out: { x: 0.5 + k, y: 0 } },
          { anchor: { x: 1, y: 0.5 }, in: { x: 1, y: 0.5 - k }, out: { x: 1, y: 0.5 + k } },
          { anchor: { x: 0.5, y: 1 }, in: { x: 0.5 + k, y: 1 }, out: { x: 0.5 - k, y: 1 } },
          { anchor: { x: 0, y: 0.5 }, in: { x: 0, y: 0.5 + k }, out: { x: 0, y: 0.5 - k } },
        ],
      };
    }
    case 'polygon':
      return { nodes: regularPolygonPoints(g.sides, w, h).map((p) => corner(norm(p))), closed: true };
    case 'star':
      return { nodes: starPoints(g.points, g.innerRatio, w, h).map((p) => corner(norm(p))), closed: true };
    case 'block-arrow':
      return { nodes: blockArrowPoints(g.shaft, g.head, w, h).map((p) => corner(norm(p))), closed: true };
    case 'line':
      return { nodes: [corner({ ...g.from }), corner({ ...g.to })], closed: false };
    case 'arrow':
      return null;
  }
}

/**
 * Rectangle with circular corners of `radius` px (clamped as in roundedRectD): two anchors
 * per rounded corner, joined by a quarter-circle curve; plain corners when the radius is 0.
 * Where the straight edge between two corners vanishes (radius = half the side) the two
 * anchors there merge into one smooth anchor.
 */
function roundedRectNodes(w: number, h: number, radius: number): PathNode[] {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) return [corner({ x: 0, y: 0 }), corner({ x: 1, y: 0 }), corner({ x: 1, y: 1 }), corner({ x: 0, y: 1 })];
  const rx = r / w;
  const ry = r / h;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  // Clockwise from the top edge; each corner: the anchor ending the edge before it, then the
  // one starting the edge after it.
  const nodes: PathNode[] = [
    // top-right
    { anchor: { x: 1 - rx, y: 0 }, in: null, out: { x: 1 - rx + kx, y: 0 } },
    { anchor: { x: 1, y: ry }, in: { x: 1, y: ry - ky }, out: null },
    // bottom-right
    { anchor: { x: 1, y: 1 - ry }, in: null, out: { x: 1, y: 1 - ry + ky } },
    { anchor: { x: 1 - rx, y: 1 }, in: { x: 1 - rx + kx, y: 1 }, out: null },
    // bottom-left
    { anchor: { x: rx, y: 1 }, in: null, out: { x: rx - kx, y: 1 } },
    { anchor: { x: 0, y: 1 - ry }, in: { x: 0, y: 1 - ry + ky }, out: null },
    // top-left
    { anchor: { x: 0, y: ry }, in: null, out: { x: 0, y: ry - ky } },
    { anchor: { x: rx, y: 0 }, in: { x: rx - kx, y: 0 }, out: null },
  ];
  // Merge anchors that coincide (no straight edge left between two corners).
  const out: PathNode[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.anchor.x - n.anchor.x) < 1e-9 && Math.abs(prev.anchor.y - n.anchor.y) < 1e-9) {
      out[out.length - 1] = { anchor: prev.anchor, in: prev.in, out: n.out };
    } else out.push(n);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && Math.abs(first.anchor.x - last.anchor.x) < 1e-9 && Math.abs(first.anchor.y - last.anchor.y) < 1e-9) {
    out[0] = { anchor: first.anchor, in: last.in, out: first.out };
    out.pop();
  }
  return out;
}

/** The shape as a path with the same id, name, box, paint, effects and state, or null. */
export function shapeToPath(o: ShapeObject): PathObject | null {
  const r = shapeToPathNodes(o.shape, o.box.width, o.box.height);
  if (!r) return null;
  const { shape: _shape, type: _type, ...rest } = o;
  // An open line never has a fill.
  return { ...rest, type: 'path', nodes: r.nodes, closed: r.closed, ...(r.closed ? {} : { fill: null }) };
}
