import { current, isDraft } from 'immer';
import { newId } from './factory';
import type { Id, Layer, SceneObject, SparcaDocument } from './types';

export interface ObjectLocation {
  layer: Layer;
  /** The array that directly contains the object (a layer's or a group's children). */
  siblings: SceneObject[];
  index: number;
  object: SceneObject;
  /** Ancestor groups, outermost first. */
  ancestors: SceneObject[];
}

export function findObject(doc: SparcaDocument, id: Id): ObjectLocation | null {
  for (const layer of doc.layers) {
    const found = findIn(layer, layer.children, id, []);
    if (found) return found;
  }
  return null;
}

function findIn(
  layer: Layer,
  siblings: SceneObject[],
  id: Id,
  ancestors: SceneObject[],
): ObjectLocation | null {
  for (let i = 0; i < siblings.length; i++) {
    const o = siblings[i];
    if (o.id === id) return { layer, siblings, index: i, object: o, ancestors };
    if (o.type === 'group') {
      const found = findIn(layer, o.children, id, [...ancestors, o]);
      if (found) return found;
    }
  }
  return null;
}

export function findLayer(doc: SparcaDocument, id: Id): Layer | null {
  return doc.layers.find((l) => l.id === id) ?? null;
}

/** Layer that contains a given object (top-level or nested). */
export function layerOfObject(doc: SparcaDocument, id: Id): Layer | null {
  return findObject(doc, id)?.layer ?? null;
}

/** All objects in drawing order, depth-first, including groups themselves. */
export function walkObjects(objects: SceneObject[], fn: (o: SceneObject) => void): void {
  for (const o of objects) {
    fn(o);
    if (o.type === 'group') walkObjects(o.children, fn);
  }
}

export function allObjects(doc: SparcaDocument): SceneObject[] {
  const out: SceneObject[] = [];
  for (const l of doc.layers) walkObjects(l.children, (o) => out.push(o));
  return out;
}

/** Whether the object or any ancestor/layer is hidden or locked. */
export function isEffectivelyLocked(loc: ObjectLocation): boolean {
  return loc.layer.locked || loc.object.locked || loc.ancestors.some((a) => a.locked);
}

export function isEffectivelyVisible(loc: ObjectLocation): boolean {
  return loc.layer.visible && loc.object.visible && loc.ancestors.every((a) => a.visible);
}

/** Deep copy with fresh ids (for duplicate / paste). */
export function cloneWithNewIds<T extends SceneObject>(o: T): T {
  const copy = structuredClone(isDraft(o) ? (current(o as never) as T) : o);
  reassign(copy);
  return copy;
}

function reassign(o: SceneObject) {
  o.id = newId(o.type === 'group' ? 'g' : 'o');
  if (o.type === 'group') o.children.forEach(reassign);
}

export function cloneLayerWithNewIds(layer: Layer): Layer {
  const copy = structuredClone(isDraft(layer) ? (current(layer as never) as Layer) : layer);
  copy.id = newId('l');
  copy.children.forEach(reassign);
  return copy;
}

/** Asset ids referenced anywhere in the document. */
export function referencedAssets(doc: SparcaDocument): Set<string> {
  const ids = new Set<string>();
  for (const o of allObjects(doc)) if (o.type === 'image') ids.add(o.assetId);
  return ids;
}
