import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import {
  addLayer, addObject, duplicateObjects, groupObjects, moveLayer, removeLayer, removeObjects,
  reorderObjects, transformObjects, ungroupObjects, updateLayer,
} from './commands';
import { createDocument, createShape, defaultGeometry } from './factory';
import { findObject } from './tree';
import type { SparcaDocument } from './types';

function docWith(n: number): { doc: SparcaDocument; ids: string[] } {
  let doc = createDocument();
  const ids: string[] = [];
  doc = produce(doc, (d) => {
    for (let i = 0; i < n; i++) {
      const s = createShape(defaultGeometry('rect'), { x: i * 10, y: 0, width: 10, height: 10, rotation: 0 });
      ids.push(s.id);
      addObject(d, d.layers[0].id, s);
    }
  });
  return { doc, ids };
}

const order = (doc: SparcaDocument) => doc.layers[0].children.map((o) => o.id);

describe('object commands', () => {
  it('reorders objects', () => {
    const { doc, ids } = docWith(4);
    expect(order(produce(doc, (d) => reorderObjects(d, [ids[0]], 'front')))).toEqual([ids[1], ids[2], ids[3], ids[0]]);
    expect(order(produce(doc, (d) => reorderObjects(d, [ids[3]], 'back')))).toEqual([ids[3], ids[0], ids[1], ids[2]]);
    expect(order(produce(doc, (d) => reorderObjects(d, [ids[1]], 'forward')))).toEqual([ids[0], ids[2], ids[1], ids[3]]);
    expect(order(produce(doc, (d) => reorderObjects(d, [ids[2], ids[3]], 'backward')))).toEqual([ids[0], ids[2], ids[3], ids[1]]);
  });

  it('does not modify locked objects', () => {
    const { doc, ids } = docWith(2);
    const locked = produce(doc, (d) => { d.layers[0].locked = true; });
    const after = produce(locked, (d) => {
      removeObjects(d, [ids[0]]);
      transformObjects(d, [ids[1]], { pivot: { x: 0, y: 0 }, sx: 1, sy: 1, rotation: 0, dx: 5, dy: 0 });
    });
    expect(after).toBe(locked);
  });

  it('duplicates with fresh ids and keeps the original', () => {
    const { doc, ids } = docWith(1);
    let newIds: string[] = [];
    const after = produce(doc, (d) => { newIds = duplicateObjects(d, ids); });
    expect(after.layers[0].children).toHaveLength(2);
    expect(newIds[0]).not.toBe(ids[0]);
    const copy = findObject(after, newIds[0])!.object;
    expect(copy.type === 'shape' && copy.box.x).toBe(10);
  });

  it('groups, moves as a unit, and ungroups', () => {
    const { doc, ids } = docWith(3);
    let gid: string | null = null;
    let after = produce(doc, (d) => { gid = groupObjects(d, [ids[0], ids[2]]); });
    expect(gid).not.toBeNull();
    expect(after.layers[0].children.map((o) => o.type)).toEqual(['shape', 'group']);
    after = produce(after, (d) => transformObjects(d, [gid!], { pivot: { x: 0, y: 0 }, sx: 1, sy: 1, rotation: 0, dx: 0, dy: 50 }));
    const c0 = findObject(after, ids[0])!.object;
    expect(c0.type === 'shape' && c0.box.y).toBe(50);
    after = produce(after, (d) => { ungroupObjects(d, [gid!]); });
    expect(order(after)).toEqual([ids[1], ids[0], ids[2]]);
  });

  it('rotating a group rotates children around the group center', () => {
    const { doc, ids } = docWith(2); // boxes at x=0 and x=10, centers (5,5) and (15,5)
    const after = produce(doc, (d) => transformObjects(d, ids, { pivot: { x: 10, y: 5 }, sx: 1, sy: 1, rotation: 180, dx: 0, dy: 0 }));
    const a = findObject(after, ids[0])!.object;
    if (a.type !== 'shape') throw new Error();
    expect(a.box.x).toBeCloseTo(10);
    expect(Math.abs(a.box.rotation)).toBe(180);
  });
});

describe('layer commands', () => {
  it('adds, renames, hides, reorders and removes layers', () => {
    const doc = createDocument();
    let id = '';
    let after = produce(doc, (d) => { id = addLayer(d).id; });
    expect(after.layers).toHaveLength(2);
    after = produce(after, (d) => updateLayer(d, id, { name: '背景', visible: false }));
    expect(after.layers[1]).toMatchObject({ name: '背景', visible: false });
    after = produce(after, (d) => moveLayer(d, id, 0));
    expect(after.layers[0].id).toBe(id);
    after = produce(after, (d) => { removeLayer(d, id); });
    expect(after.layers).toHaveLength(1);
    expect(produce(after, (d) => { removeLayer(d, d.layers[0].id); }).layers).toHaveLength(1);
  });
});
