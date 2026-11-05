// Mask layers (types.ts ObjectMask): new masks, the frame the content follows, and mapping
// the content of a leaf's mask onto its current box.
import { boxCenter, transformObject, unionBounds, IDENTITY_TRANSFORM } from './geometry';
import { createShape, defaultGeometry as shapeGeometry, newId } from './factory';
import { defaultGeometry } from './gradient';
import type { Box, Gradient, ObjectMask, SceneObject, ShapeObject } from './types';

/** The box the mask is made against: the object's box, or for a group the bounds of its children. */
export function maskFrame(o: SceneObject): Box | null {
  if (o.type !== 'group') return o.box;
  const b = unionBounds(o.children);
  return b ? { ...b, rotation: 0 } : null;
}

/** An empty mask: all shows (white) or all hidden (black). */
export function newMask(o: SceneObject, background: 'white' | 'black'): ObjectMask | null {
  const frame = maskFrame(o);
  if (!frame) return null;
  return { background, children: [], enabled: true, ...(o.type === 'group' ? {} : { frame }) };
}

/**
 * A rectangle over `frame` widened by `margin` on every side (how far strokes and effects show
 * past the box, so they are covered too), filled with `gradient` given in coordinates
 * normalized to `frame`.
 */
export function gradientRect(frame: Box, gradient: Gradient, margin = 0, name = 'グラデーション'): ShapeObject {
  const m = Math.max(0, margin);
  const w = frame.width + 2 * m;
  const h = frame.height + 2 * m;
  const c = boxCenter(frame);
  const map = (p: { x: number; y: number }) => ({ x: (p.x * frame.width + m) / w, y: (p.y * frame.height + m) / h });
  return {
    ...createShape(shapeGeometry('rect'), { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h, rotation: frame.rotation }),
    id: newId('o'),
    name,
    fill: { ...gradient, start: map(gradient.start), end: map(gradient.end) },
    stroke: null,
    strokeWidth: 0,
  };
}

export const WHITE_TO_BLACK: Gradient = {
  kind: 'linear',
  ...defaultGeometry('linear'),
  stops: [
    { offset: 0, color: '#ffffff', opacity: 1 },
    { offset: 1, color: '#000000', opacity: 1 },
  ],
};

/**
 * A mask with a white-to-black gradient (left shows, right fades out): the グラデーションマスク.
 * `margin`: how far the object shows past its box (strokes, effects).
 */
export function newGradientMask(o: SceneObject, margin = 0, gradient: Gradient = WHITE_TO_BLACK): ObjectMask | null {
  const mask = newMask(o, 'black');
  const frame = maskFrame(o);
  if (!mask || !frame) return null;
  return { ...mask, children: [gradientRect(frame, gradient, margin)] };
}

/** Whether a leaf's mask content needs mapping (its box changed since the content was placed). */
function moved(a: Box, b: Box): boolean {
  return a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height || a.rotation !== b.rotation;
}

/**
 * SVG transform taking a leaf's mask content (document coordinates as of `frame`) into the
 * object's own unrotated frame of its current box (where the object is drawn).
 */
export function maskContentTransform(frame: Box, box: Box): string {
  const sx = box.width / (frame.width || 1);
  const sy = box.height / (frame.height || 1);
  const c = boxCenter(frame);
  return `scale(${sx} ${sy}) translate(${-frame.x} ${-frame.y})` + (frame.rotation ? ` rotate(${-frame.rotation} ${c.x} ${c.y})` : '');
}

/**
 * For a leaf, the frame its mask content is mapped from onto its box: where the content was
 * placed, or — unlinked — the box itself (the content stays put on the canvas). Null for groups.
 */
export function contentFrame(o: SceneObject): Box | null {
  if (o.type === 'group' || !o.mask) return null;
  return o.mask.linked === false ? o.box : (o.mask.frame ?? o.box);
}

/**
 * The leaf's mask with its content moved onto the current box (in document coordinates), and
 * `frame` set to the box — done before editing the content, so the ordinary tools work on it.
 * (Scaling along turned axes is approximated, as for groups.)
 */
export function settleMask(o: SceneObject): ObjectMask | undefined {
  const mask = o.mask;
  if (!mask || o.type === 'group' || mask.linked === false || !mask.frame || !moved(mask.frame, o.box)) return mask;
  const f = mask.frame;
  const b = o.box;
  const fc = boxCenter(f);
  const bc = boxCenter(b);
  const step = (c: SceneObject) => {
    let x = transformObject(c, { ...IDENTITY_TRANSFORM, pivot: fc, rotation: -f.rotation });
    x = transformObject(x, { ...IDENTITY_TRANSFORM, pivot: fc, sx: b.width / (f.width || 1), sy: b.height / (f.height || 1) });
    return transformObject(x, { ...IDENTITY_TRANSFORM, pivot: fc, rotation: b.rotation, dx: bc.x - fc.x, dy: bc.y - fc.y });
  };
  return { ...mask, children: mask.children.map(step), frame: { ...b } };
}
