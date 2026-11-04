// グラデーションツール (as in Fireworks): drag over the selected object to set where its
// gradient starts and ends. Decided with the user 2026-11-02: it sets the fill (text: its
// color) by default, or the stroke or the gradient mask as chosen in the tool settings; a
// solid (or no) fill becomes a linear gradient from its color to white.
import { docToNormalized, isGradient, toGradient } from '../model/gradient';
import { gradientRect, maskFrame, newMask, settleMask, WHITE_TO_BLACK } from '../model/mask';
import { findObject } from '../model/tree';
import type { Gradient, PathObject, Point, SceneObject, ShapeObject, SparcaDocument } from '../model/types';

export type GradientToolTarget = 'fill' | 'stroke' | 'mask';

/** What a drag sets on the object: images and groups only have a mask; lines only a stroke; text a color. */
export type GradientSlot = 'fill' | 'color' | 'stroke' | 'mask';

export function gradientSlot(o: SceneObject, want: GradientToolTarget): GradientSlot {
  if (o.type === 'image' || o.type === 'group' || want === 'mask') return 'mask';
  if (o.type === 'text') return 'color';
  const open = o.type === 'path' ? !o.closed : o.shape.kind === 'line' || o.shape.kind === 'arrow';
  return open || want === 'stroke' ? 'stroke' : 'fill';
}

/**
 * Set the gradient in `slot` of object `id` (in a draft document) to run from `from` to `to`
 * (document coordinates). An existing gradient keeps its kind and colors.
 */
export function applyGradientDrag(d: SparcaDocument, id: string, slot: GradientSlot, from: Point, to: Point): void {
  const loc = findObject(d, id);
  if (!loc) return;
  const o = loc.object;
  if (slot === 'mask') {
    // Into the mask layer: the first gradient-filled shape there takes the drag; a mask
    // without one gets a gradient rectangle (white to black), and no mask a new one.
    const frame = maskFrame(o);
    if (!frame) return;
    const mask = settleMask(o) ?? newMask(o, 'black');
    if (!mask) return;
    let target = mask.children.find((c): c is ShapeObject | PathObject => (c.type === 'shape' || c.type === 'path') && isGradient(c.fill));
    const children = [...mask.children];
    if (!target) {
      target = gradientRect(frame, WHITE_TO_BLACK);
      children.push(target);
    }
    const g = target.fill as Gradient;
    const updated = { ...target, fill: { ...g, start: docToNormalized(target.box, from), end: docToNormalized(target.box, to) } };
    o.mask = { ...mask, children: children.map((c) => (c.id === updated.id ? updated : c)) };
    return;
  }
  if (o.type === 'group' || o.type === 'image') return;
  const placed = (g: Gradient): Gradient => ({ ...g, start: docToNormalized(o.box, from), end: docToNormalized(o.box, to) });
  if (slot === 'color' && o.type === 'text') {
    o.color = placed(isGradient(o.color) ? o.color : toGradient('linear', o.color));
  } else if (slot === 'fill' && (o.type === 'shape' || o.type === 'path')) {
    o.fill = placed(isGradient(o.fill) ? o.fill : toGradient('linear', o.fill));
  } else if (slot === 'stroke' && (o.type === 'shape' || o.type === 'path')) {
    o.stroke = placed(isGradient(o.stroke) ? o.stroke : toGradient('linear', o.stroke));
    if (o.strokeWidth <= 0) o.strokeWidth = 2;
  }
}
