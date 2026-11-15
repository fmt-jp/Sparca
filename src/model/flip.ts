// 左右反転・上下反転 (decided with the user 2026-11-15: each kind in its natural form).
// Objects are mirrored across a vertical (x) or horizontal (y) line through `c`:
// - paths: their outlines (and gradient fills) are mirrored;
// - shapes: rect / ellipse are symmetric; regular polygons and stars (symmetric left–right)
//   and block arrows (symmetric top–bottom) take the other mirror as a half turn; lines and
//   arrows mirror their ends;
// - images and text keep their pixels / letters and record the mirror (`flip`), so it can be
//   undone by flipping again and text stays editable;
// - groups and mask layers mirror what is in them.
// Effects keep their direction (a shadow still falls the same way).
import { isGradient } from './gradient';
import { settleMask } from './mask';
import type { Fill, PathNode, Point, SceneObject, ShapeGeometry } from './types';

export type FlipAxis = 'x' | 'y';

/** A local mirror within the unit box. */
type Mirror = 'x' | 'y';
const mirrorPoint = (p: Point, m: Mirror): Point => (m === 'x' ? { x: 1 - p.x, y: p.y } : { x: p.x, y: 1 - p.y });

function mirrorFill<F extends Fill | null>(f: F, m: Mirror): F {
  const v = f as Fill | null;
  if (!v || typeof v === 'string') return f;
  if (isGradient(v)) return { ...v, start: mirrorPoint(v.start, m), end: mirrorPoint(v.end, m) } as F;
  return { ...v, angle: -v.angle } as F; // a pattern
}

const mirrorNode = (n: PathNode, m: Mirror): PathNode => ({
  anchor: mirrorPoint(n.anchor, m),
  in: n.in && mirrorPoint(n.in, m),
  out: n.out && mirrorPoint(n.out, m),
});

const norm = (deg: number) => {
  const r = ((deg % 360) + 540) % 360 - 180;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * Which local mirror a shape takes for `axis`, and whether it is done as a half turn instead
 * (the shape is symmetric under the other mirror, so its geometry cannot show this one).
 */
function shapeMirror(g: ShapeGeometry, axis: FlipAxis): { m: Mirror; halfTurn: boolean } {
  if ((g.kind === 'polygon' || g.kind === 'star') && axis === 'y') return { m: 'x', halfTurn: true };
  if (g.kind === 'block-arrow' && axis === 'x') return { m: 'y', halfTurn: true };
  return { m: axis, halfTurn: false };
}

/** `o` mirrored across the line through `c` (vertical for 'x', horizontal for 'y'). */
export function flipObject(o: SceneObject, axis: FlipAxis, c: Point): SceneObject {
  const mirrorDoc = (p: Point): Point => (axis === 'x' ? { x: 2 * c.x - p.x, y: p.y } : { x: p.x, y: 2 * c.y - p.y });
  if (o.type === 'group') {
    const g = { ...o, children: o.children.map((k) => flipObject(k, axis, c)) };
    if (o.mask) g.mask = { ...o.mask, children: o.mask.children.map((k) => flipObject(k, axis, c)) };
    return g;
  }
  const b = o.box;
  const center = mirrorDoc({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  let rotation = norm(-b.rotation);
  let out: SceneObject;
  switch (o.type) {
    case 'path':
      out = {
        ...o,
        nodes: o.nodes.map((n) => mirrorNode(n, axis)),
        ...(o.subpaths ? { subpaths: o.subpaths.map((s) => ({ ...s, nodes: s.nodes.map((n) => mirrorNode(n, axis)) })) } : {}),
        fill: mirrorFill(o.fill, axis),
        stroke: mirrorFill(o.stroke, axis),
      };
      break;
    case 'shape': {
      const { m, halfTurn } = shapeMirror(o.shape, axis);
      if (halfTurn) rotation = norm(rotation + 180);
      const shape: ShapeGeometry =
        o.shape.kind === 'line' || o.shape.kind === 'arrow' ? { ...o.shape, from: mirrorPoint(o.shape.from, m), to: mirrorPoint(o.shape.to, m) } : o.shape;
      out = { ...o, shape, fill: mirrorFill(o.fill, m), stroke: mirrorFill(o.stroke, m) };
      break;
    }
    case 'text':
    case 'image': {
      const f = o.flip ?? { x: false, y: false };
      const flip = axis === 'x' ? { ...f, x: !f.x } : { ...f, y: !f.y };
      out = { ...o, flip } as SceneObject;
      if (!flip.x && !flip.y) delete (out as { flip?: unknown }).flip;
      break;
    }
  }
  const box = { x: center.x - b.width / 2, y: center.y - b.height / 2, width: b.width, height: b.height, rotation };
  // The mask's content, placed against the box, is mirrored with it (unlinked content stays put).
  if (o.mask) {
    const settled = settleMask(o)!;
    out = settled.linked === false ? { ...out, mask: settled } : { ...out, mask: { ...settled, children: settled.children.map((k) => flipObject(k, axis, c)), frame: box } };
  }
  return { ...out, box } as SceneObject;
}
