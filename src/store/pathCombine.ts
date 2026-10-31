// 「パスの結合」（合体・型抜き・交差・中マド）: replace the selected closed shapes / paths with
// one (compound) path. The result takes the place and the look (paint, stroke, effects,
// opacity, name, id) of the bottom-most selected object (decided with the user 2026-10-29).
// The geometry itself comes from engine/pathBoolean (paper.js, loaded on demand), passed in
// as `compute` so this part stays testable without it.
import { removeObjects } from '../model/commands';
import { boxCenter, rotatePoint } from '../model/geometry';
import { docContoursToPath, pathContoursToDoc, type DocContour } from '../model/pathEdit';
import { canConvertToPath, shapeToPath } from '../model/shapeToPath';
import { allObjects, findObject, isEffectivelyLocked } from '../model/tree';
import type { Box, Fill, Gradient, PathObject, Point, SceneObject } from '../model/types';
import type { EditorStore } from './editor';

export type CombineOp = 'unite' | 'subtract' | 'intersect' | 'exclude';

export const COMBINE_LABELS: Record<CombineOp, string> = {
  unite: '合体',
  subtract: '型抜き',
  intersect: '交差',
  exclude: '中マド',
};

export type ComputeBoolean = (objects: DocContour[][], op: CombineOp) => DocContour[];

/** A selected object as closed outlines in document coordinates, or null if it cannot take part. */
function outlinesOf(o: SceneObject): DocContour[] | null {
  let path: PathObject | null = null;
  if (o.type === 'shape' && canConvertToPath(o.shape) && o.shape.kind !== 'line') path = shapeToPath(o);
  else if (o.type === 'path') path = o;
  if (!path) return null;
  const contours = pathContoursToDoc(path);
  return contours.every((c) => c.closed && c.nodes.length >= 2) ? contours : null;
}

/** Selected objects bottom (back) first, with their outlines; or why they cannot be combined. */
function combineInputs(ed: EditorStore): { objects: { o: SceneObject; contours: DocContour[] }[] } | { error: string } {
  const { doc, selection } = ed.getState();
  const order = new Map(allObjects(doc).map((o, i) => [o.id, i]));
  const picked: { o: SceneObject; contours: DocContour[] }[] = [];
  for (const id of selection) {
    const loc = findObject(doc, id);
    if (!loc || isEffectivelyLocked(loc)) continue;
    const contours = outlinesOf(loc.object);
    if (!contours) return { error: 'パスの結合に使えるのは、閉じた図形とパスだけです（テキスト・画像・グループ・直線・開いたパスは使えません）。' };
    picked.push({ o: loc.object, contours });
  }
  if (picked.length < 2) return { error: 'パスの結合には、閉じた図形やパスを 2 つ以上選択してください。' };
  picked.sort((a, b) => order.get(a.o.id)! - order.get(b.o.id)!);
  return { objects: picked };
}

/** Whether 「パスの結合」 can run on the current selection (for enabling menu items). */
export function canCombineSelection(ed: EditorStore): boolean {
  return 'objects' in combineInputs(ed);
}

const NO_ROTATION: Box = { x: 0, y: 0, width: 1, height: 1, rotation: 0 };

/** A box-relative fill (gradient points) moved from the old box to the new one, staying in place. */
function refitFill<F extends Fill>(fill: F | null, from: Box, to: Box): F | null {
  if (!fill || typeof fill === 'string' || fill.kind === 'pattern') return fill;
  const g: Gradient = fill;
  const move = (p: Point): Point => {
    const d = rotatePoint({ x: from.x + p.x * from.width, y: from.y + p.y * from.height }, boxCenter(from), from.rotation);
    return { x: (d.x - to.x) / to.width, y: (d.y - to.y) / to.height };
  };
  return { ...g, start: move(g.start), end: move(g.end) } as F;
}

/**
 * Run 合体 / 型抜き / 交差 / 中マド on the selection. One undo step; the result is selected.
 * Shows an error and changes nothing when the selection cannot be combined or nothing is left.
 */
export function combineSelection(ed: EditorStore, op: CombineOp, compute: ComputeBoolean): boolean {
  const input = combineInputs(ed);
  if ('error' in input) {
    ed.notify('error', input.error);
    return false;
  }
  const contours = compute(
    input.objects.map((x) => x.contours),
    op,
  );
  if (!contours.length) {
    ed.notify('error', `${COMBINE_LABELS[op]}した結果、形が残りません（図形が重なっていない可能性があります）。`);
    return false;
  }
  const bottom = input.objects[0].o as Exclude<SceneObject, { type: 'group' }>;
  const geometry = docContoursToPath(NO_ROTATION, contours);
  const paint = bottom.type === 'shape' || bottom.type === 'path' ? bottom : null;
  const result: PathObject = {
    id: bottom.id,
    name: bottom.name,
    type: 'path',
    visible: bottom.visible,
    locked: false,
    opacity: bottom.opacity,
    effects: bottom.effects,
    fill: refitFill(paint?.fill ?? null, bottom.box, geometry.box),
    stroke: refitFill(paint?.stroke ?? null, bottom.box, geometry.box),
    strokeWidth: paint?.strokeWidth ?? 0,
    ...(paint?.strokeStyle ? { strokeStyle: paint.strokeStyle } : {}),
    ...(paint?.strokeCap ? { strokeCap: paint.strokeCap } : {}),
    ...(paint?.strokeJoin ? { strokeJoin: paint.strokeJoin } : {}),
    ...geometry,
  };
  if (!result.subpaths) delete result.subpaths;
  const others = input.objects.slice(1).map((x) => x.o.id);
  ed.edit(`パスの${COMBINE_LABELS[op]}`, (d) => {
    const loc = findObject(d, bottom.id);
    if (loc) loc.siblings[loc.index] = result;
    removeObjects(d, others);
  });
  ed.select([bottom.id]);
  return true;
}
