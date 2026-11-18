// Setting fill, stroke and effects of several objects at once (2026-11-18, decided with the
// user): what the selection reaches (groups pass it on to what they hold, locked objects are
// left alone), whether a setting is the same for all, and applying one setting to all.
import { findObject, isEffectivelyLocked } from './tree';
import { newId } from './factory';
import type { Effect, Fill, Id, Paint, SceneObject, SparcaDocument, Stroke } from './types';

export type Leaf = Exclude<SceneObject, { type: 'group' }>;
export type Painted = Extract<Leaf, { type: 'shape' | 'path' }>;

/** The objects a selection reaches: groups give their content, locked ones are left out. */
export function selectionLeaves(doc: SparcaDocument, ids: Id[]): Leaf[] {
  const out: Leaf[] = [];
  const walk = (o: SceneObject) => {
    if (o.locked) return;
    if (o.type === 'group') o.children.forEach(walk);
    else out.push(o);
  };
  for (const id of ids) {
    const loc = findObject(doc, id);
    if (loc && !isEffectivelyLocked(loc)) walk(loc.object);
  }
  return out;
}

export const isPainted = (o: Leaf): o is Painted => o.type === 'shape' || o.type === 'path';
export const isLineLike = (o: Painted) => (o.type === 'shape' ? o.shape.kind === 'line' || o.shape.kind === 'arrow' : !o.closed);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether the values differ (an empty list is not mixed). */
export function isMixed(values: unknown[]): boolean {
  return values.some((v) => !same(v, values[0]));
}

/** The fill a leaf has: shapes and closed paths their fill, text its color (images, lines none). */
export function fillOf(o: Leaf): Fill | null | undefined {
  if (o.type === 'text') return o.color;
  if (isPainted(o) && !isLineLike(o)) return o.fill;
  return undefined;
}

/** Effects without their ids (ids only tell an object's effects apart). */
const effectsKey = (fx: Effect[]) => fx.map(({ id, ...rest }) => (void id, rest));

export function effectsMixed(leaves: Leaf[]): boolean {
  return isMixed(leaves.map((o) => effectsKey(o.effects)));
}

/**
 * Apply a fill / stroke change to a leaf (a draft). A fill goes to shapes and closed paths, and
 * to text as its color (unless it is none); stroke settings go to shapes and paths. A stroke
 * given to an object without one gets a 2 px width (as for one object) when the change brings
 * no width of its own for it.
 */
export function applyPaint(o: Leaf, patch: Partial<Paint>, widthOnlyIfNone = false): void {
  if ('fill' in patch) {
    if (o.type === 'text') {
      if (patch.fill) o.color = structuredClone(patch.fill);
    } else if (isPainted(o) && !isLineLike(o)) o.fill = structuredClone(patch.fill ?? null);
  }
  if (!isPainted(o)) return;
  if ('stroke' in patch) o.stroke = structuredClone((patch.stroke ?? null) as Stroke | null);
  if (patch.strokeWidth !== undefined && (!widthOnlyIfNone || o.strokeWidth === 0)) o.strokeWidth = patch.strokeWidth;
  if (patch.strokeStyle !== undefined) o.strokeStyle = patch.strokeStyle;
  if (patch.strokeCap !== undefined) o.strokeCap = patch.strokeCap;
  if (patch.strokeJoin !== undefined) o.strokeJoin = patch.strokeJoin;
}

/** Give a leaf (a draft) its own copy of this effects list (ids need only be unique within an object). */
export function setAllEffects(o: Leaf, effects: Effect[]): void {
  o.effects = structuredClone(effects);
}

/** Add an effect at the end of a leaf's (a draft) effects. */
export function appendEffect(o: Leaf, e: Effect): void {
  o.effects = [...o.effects, { ...structuredClone(e), id: o.effects.some((x) => x.id === e.id) ? newId('fx') : e.id }];
}
