// Document edit operations. Each function mutates an Immer draft of the document.
import { createGroup, createLayer } from './factory';
import { transformObject, type ObjectTransform } from './geometry';
import { cloneLayerWithNewIds, cloneWithNewIds, findObject, isEffectivelyLocked } from './tree';
import type { Id, Layer, SceneObject, SparcaDocument } from './types';

export function addObject(doc: SparcaDocument, layerId: Id, obj: SceneObject): void {
  const layer = doc.layers.find((l) => l.id === layerId) ?? doc.layers[doc.layers.length - 1];
  if (!layer) throw new Error('レイヤーがありません');
  layer.children.push(obj);
}

/** Apply a partial update to a leaf or group (shallow merge). */
export function updateObject(doc: SparcaDocument, id: Id, patch: Partial<SceneObject>): void {
  const loc = findObject(doc, id);
  if (!loc) return;
  Object.assign(loc.siblings[loc.index], patch);
}

export function removeObjects(doc: SparcaDocument, ids: Id[]): void {
  for (const id of ids) {
    const loc = findObject(doc, id);
    if (loc && !isEffectivelyLocked(loc)) loc.siblings.splice(loc.index, 1);
  }
  pruneEmptyGroups(doc);
}

function pruneEmptyGroups(doc: SparcaDocument) {
  const prune = (arr: SceneObject[]) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      const o = arr[i];
      if (o.type === 'group') {
        prune(o.children);
        if (o.children.length === 0) arr.splice(i, 1);
      }
    }
  };
  doc.layers.forEach((l) => prune(l.children));
}

/** Transform the given objects (skipping locked ones). */
export function transformObjects(doc: SparcaDocument, ids: Id[], t: ObjectTransform): void {
  for (const id of ids) {
    const loc = findObject(doc, id);
    if (!loc || isEffectivelyLocked(loc)) continue;
    loc.siblings[loc.index] = transformObject(loc.siblings[loc.index], t);
  }
}

/** Duplicate objects in place (above the originals) offset by (dx, dy). Returns new ids. */
export function duplicateObjects(doc: SparcaDocument, ids: Id[], dx = 10, dy = 10): Id[] {
  const out: Id[] = [];
  for (const id of ids) {
    const loc = findObject(doc, id);
    if (!loc) continue;
    const copy = transformObject(cloneWithNewIds(loc.object), {
      pivot: { x: 0, y: 0 }, sx: 1, sy: 1, rotation: 0, dx, dy,
    });
    copy.name = loc.object.name;
    loc.siblings.splice(loc.index + 1, 0, copy);
    out.push(copy.id);
  }
  return out;
}

/** Insert copies of objects (clipboard paste) into a layer. Returns new ids. */
export function pasteObjects(doc: SparcaDocument, layerId: Id, objects: SceneObject[], dx: number, dy: number): Id[] {
  const layer = doc.layers.find((l) => l.id === layerId) ?? doc.layers[doc.layers.length - 1];
  const out: Id[] = [];
  for (const o of objects) {
    const copy = transformObject(cloneWithNewIds(o), { pivot: { x: 0, y: 0 }, sx: 1, sy: 1, rotation: 0, dx, dy });
    layer.children.push(copy);
    out.push(copy.id);
  }
  return out;
}

export type ZOrderOp = 'front' | 'forward' | 'backward' | 'back';

/** Change stacking order of objects within their parent. */
export function reorderObjects(doc: SparcaDocument, ids: Id[], op: ZOrderOp): void {
  // Process so relative order of selected siblings is preserved.
  const locs = ids
    .map((id) => findObject(doc, id))
    .filter((l): l is NonNullable<typeof l> => !!l);
  const bySiblings = new Map<SceneObject[], Set<Id>>();
  for (const l of locs) {
    if (!bySiblings.has(l.siblings)) bySiblings.set(l.siblings, new Set());
    bySiblings.get(l.siblings)!.add(l.object.id);
  }
  for (const [arr, set] of bySiblings) {
    const moving = arr.filter((o) => set.has(o.id));
    const rest = arr.filter((o) => !set.has(o.id));
    let result: SceneObject[];
    if (op === 'front') result = [...rest, ...moving];
    else if (op === 'back') result = [...moving, ...rest];
    else {
      result = [...arr];
      const step = op === 'forward' ? 1 : -1;
      const indices = result.map((o, i) => (set.has(o.id) ? i : -1)).filter((i) => i >= 0);
      if (step === 1) indices.reverse();
      for (const i of indices) {
        const j = i + step;
        if (j < 0 || j >= result.length || set.has(result[j].id)) continue;
        [result[i], result[j]] = [result[j], result[i]];
      }
    }
    arr.splice(0, arr.length, ...result);
  }
}

/** Group objects that share a parent. Returns the group id or null. */
export function groupObjects(doc: SparcaDocument, ids: Id[]): Id | null {
  const locs = ids.map((id) => findObject(doc, id)).filter((l): l is NonNullable<typeof l> => !!l);
  if (locs.length < 2) return null;
  const parent = locs[0].siblings;
  if (locs.some((l) => l.siblings !== parent || isEffectivelyLocked(l))) return null;
  const set = new Set(locs.map((l) => l.object.id));
  const members = parent.filter((o) => set.has(o.id));
  const topIndex = Math.max(...locs.map((l) => l.index));
  const group = createGroup(members);
  const insertAt = topIndex - (members.length - 1);
  const rest = parent.filter((o) => !set.has(o.id));
  rest.splice(insertAt, 0, group);
  parent.splice(0, parent.length, ...rest);
  return group.id;
}

/** Dissolve groups, keeping their children in place. Returns the released child ids. */
export function ungroupObjects(doc: SparcaDocument, ids: Id[]): Id[] {
  const out: Id[] = [];
  for (const id of ids) {
    const loc = findObject(doc, id);
    if (!loc || loc.object.type !== 'group' || isEffectivelyLocked(loc)) continue;
    const children = loc.object.children;
    loc.siblings.splice(loc.index, 1, ...children);
    out.push(...children.map((c) => c.id));
  }
  return out;
}

/** Move an object to another layer (top of that layer). */
export function moveObjectToLayer(doc: SparcaDocument, id: Id, layerId: Id, index?: number): void {
  const loc = findObject(doc, id);
  const target = doc.layers.find((l) => l.id === layerId);
  if (!loc || !target) return;
  const [obj] = loc.siblings.splice(loc.index, 1);
  const at = index === undefined ? target.children.length : Math.max(0, Math.min(index, target.children.length));
  target.children.splice(at, 0, obj);
}

// ---- Layers ----

export function addLayer(doc: SparcaDocument, aboveLayerId?: Id): Layer {
  const n = doc.layers.length + 1;
  let name = `レイヤー ${n}`;
  let k = n;
  while (doc.layers.some((l) => l.name === name)) name = `レイヤー ${++k}`;
  const layer = createLayer(name);
  const idx = aboveLayerId ? doc.layers.findIndex((l) => l.id === aboveLayerId) : -1;
  doc.layers.splice(idx >= 0 ? idx + 1 : doc.layers.length, 0, layer);
  return layer;
}

export function removeLayer(doc: SparcaDocument, id: Id): boolean {
  if (doc.layers.length <= 1) return false;
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return false;
  doc.layers.splice(i, 1);
  return true;
}

export function duplicateLayer(doc: SparcaDocument, id: Id): Layer | null {
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return null;
  const copy = cloneLayerWithNewIds(doc.layers[i]);
  copy.name = `${doc.layers[i].name} のコピー`;
  doc.layers.splice(i + 1, 0, copy);
  return copy;
}

export function updateLayer(doc: SparcaDocument, id: Id, patch: Partial<Pick<Layer, 'name' | 'visible' | 'locked'>>): void {
  const l = doc.layers.find((x) => x.id === id);
  if (l) Object.assign(l, patch);
}

/** Move a layer to a new index (0 = bottom). */
export function moveLayer(doc: SparcaDocument, id: Id, toIndex: number): void {
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return;
  const [l] = doc.layers.splice(i, 1);
  doc.layers.splice(Math.max(0, Math.min(toIndex, doc.layers.length)), 0, l);
}
