import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { addObject, groupObjects, updateObject } from '../model/commands';
import { createShape, defaultGeometry } from '../model/factory';
import { transformObject, IDENTITY_TRANSFORM } from '../model/geometry';
import { settleMask } from '../model/mask';
import { findObject } from '../model/tree';
import type { GroupObject, SceneObject, ShapeObject } from '../model/types';
import { DocumentSvg } from '../render/DocumentSvg';
import { EditorStore } from './editor';
import { addGradientMask, addMask, canAddMask, enterMaskEdit, exitMaskEdit, groupAsMask, maskOwner, removeMask, setMask, setMaskLinked } from './maskActions';

const rect = (id: string, x: number, y: number, w = 100, h = 50): ShapeObject => ({
  ...createShape(defaultGeometry('rect'), { x, y, width: w, height: h, rotation: 0 }),
  id,
});

function editorWith(objects: SceneObject[]) {
  const ed = new EditorStore();
  ed.edit('add', (d) => objects.forEach((o) => addObject(d, d.layers[0].id, o)));
  return ed;
}

const svgOf = (ed: EditorStore, maskEdit: { id: string; view: 'result' | 'mask' } | null = null) =>
  renderToStaticMarkup(createElement(DocumentSvg, { doc: ed.getState().doc, options: { imageHref: () => undefined, maskEdit } }));
const first = (ed: EditorStore) => ed.getState().doc.layers[0].children[0];

describe('マスクレイヤー', () => {
  it('グラデーションマスク: a black mask holding a white-to-black rectangle; editing starts; one undo step', () => {
    const ed = editorWith([rect('r', 10, 10)]);
    ed.select(['r']);
    expect(canAddMask(ed)).toBe(true);
    expect(addGradientMask(ed)).toBe(true);
    const m = first(ed).mask!;
    expect(m).toMatchObject({ background: 'black', enabled: true, frame: { x: 10, y: 10, width: 100, height: 50 } });
    expect(m.children).toHaveLength(1);
    expect((m.children[0] as ShapeObject).fill).toMatchObject({ kind: 'linear', stops: [{ color: '#ffffff' }, { color: '#000000' }] });
    expect(ed.getState().maskEdit).toBe('r');
    expect(maskOwner(ed)?.id).toBe('r');
    const svg = svgOf(ed);
    expect(svg).toContain('<mask id="sp-mask-r"');
    expect(svg).toContain('mask="url(#sp-mask-r)"');
    ed.undo();
    expect(first(ed).mask).toBeUndefined();
  });

  it('white / black masks; drawing while editing goes into the mask; selecting outside ends editing', () => {
    const ed = editorWith([rect('r', 10, 10), rect('other', 300, 10)]);
    ed.select(['r']);
    addMask(ed, 'white');
    expect(first(ed).mask).toMatchObject({ background: 'white', children: [] });
    const star = { ...createShape(defaultGeometry('star'), { x: 20, y: 15, width: 30, height: 30, rotation: 0 }), id: 's', fill: '#000000' };
    ed.edit('draw', (d) => addObject(d, d.layers[0].id, star, ed.getState().maskEdit));
    expect(first(ed).mask!.children.map((c) => c.id)).toEqual(['s']);
    expect(ed.getState().doc.layers[0].children).toHaveLength(2); // not on the layer
    // The mask content is found like any object (so the ordinary edits work on it).
    expect(findObject(ed.getState().doc, 's')?.maskOwner?.id).toBe('r');
    ed.select(['s']);
    expect(ed.getState().maskEdit).toBe('r');
    // Editing mask content keeps it selected (its color can be changed again).
    ed.edit('color', (d) => updateObject(d, 's', { fill: '#ffffff' } as Partial<SceneObject>));
    expect(ed.getState().selection).toEqual(['s']);
    ed.select(['other']);
    expect(ed.getState().maskEdit).toBeNull();
  });

  it('can be switched off (kept but not drawn), and removed', () => {
    const ed = editorWith([rect('r', 10, 10)]);
    ed.select(['r']);
    addGradientMask(ed);
    exitMaskEdit(ed);
    expect(ed.getState().selection).toEqual(['r']);
    setMask(ed, 'r', { enabled: false }, 'off');
    expect(svgOf(ed)).not.toContain('<mask');
    expect(removeMask(ed)).toBe(true);
    expect(first(ed).mask).toBeUndefined();
  });

  it('wraps the effects too: the mask is outside the filter', () => {
    const ed = editorWith([{ ...rect('r', 10, 10), effects: [{ id: 'e', kind: 'blur', enabled: true, strength: 1, radius: 3 } as ShapeObject['effects'][number]] }]);
    ed.select(['r']);
    addGradientMask(ed);
    const svg = svgOf(ed);
    expect(svg.indexOf('mask="url(#sp-mask-r)"')).toBeLessThan(svg.indexOf('filter="url(#sp-fx-r)"'));
  });

  it("a leaf's mask content follows its box; editing first places it against the current box", () => {
    const ed = editorWith([rect('r', 0, 0)]);
    ed.select(['r']);
    addMask(ed, 'black');
    ed.edit('draw', (d) => addObject(d, d.layers[0].id, { ...rect('w', 10, 10, 20, 20), fill: '#ffffff' }, 'r'));
    exitMaskEdit(ed);
    // Move and double the width of the object.
    ed.edit('resize', (d) => updateObject(d, 'r', { box: { x: 100, y: 0, width: 200, height: 50, rotation: 0 } }));
    expect(svgOf(ed)).toContain('scale(2 1)');
    const settled = settleMask(first(ed))!;
    expect((settled.children[0] as ShapeObject).box).toMatchObject({ x: 120, y: 10, width: 40, height: 20 });
    expect(settled.frame).toMatchObject({ x: 100, width: 200 });
    enterMaskEdit(ed, 'r');
    expect((first(ed).mask!.children[0] as ShapeObject).box.x).toBeCloseTo(120);
  });

  it("a group's mask content moves, scales and turns with the group", () => {
    const ed = editorWith([rect('a', 0, 0), rect('b', 200, 100)]);
    let gid = '';
    ed.edit('group', (d) => {
      gid = groupObjects(d, ['a', 'b'])!;
    });
    ed.select([gid]);
    addGradientMask(ed);
    const g = first(ed) as GroupObject;
    expect(g.mask!.frame).toBeUndefined();
    const before = (g.mask!.children[0] as ShapeObject).box;
    const moved = transformObject(g, { ...IDENTITY_TRANSFORM, dx: 10, dy: 20 });
    expect((moved.mask!.children[0] as ShapeObject).box).toMatchObject({ x: before.x + 10, y: before.y + 20 });
    expect(svgOf(ed)).toContain(`mask="url(#sp-mask-${gid})"`);
  });

  it('editing shows the content for picking, or the mask itself in gray', () => {
    const ed = editorWith([rect('r', 10, 10)]);
    ed.select(['r']);
    addGradientMask(ed);
    expect(svgOf(ed, { id: 'r', view: 'result' })).toContain('data-mask-of="r"');
    const gray = svgOf(ed, { id: 'r', view: 'mask' });
    expect(gray).toContain('feColorMatrix');
    expect(gray).not.toContain('mask="url(#sp-mask-r)"'); // the object itself is not drawn
  });

  it('needs exactly one unlocked object', () => {
    const ed = editorWith([rect('a', 0, 0), { ...rect('l', 0, 0), locked: true }]);
    ed.select(['a', 'l']);
    expect(addGradientMask(ed)).toBe(false);
    ed.select(['l']);
    expect(canAddMask(ed)).toBe(false);
    ed.getState().notices.forEach((n) => ed.dismiss(n.id));
  });
});

describe('the gradient rectangle of a グラデーションマスク', () => {
  it('covers the box and what shows past it (stroke, shadow), not much more', () => {
    const shadow = { id: 'e', kind: 'drop-shadow', enabled: true, strength: 1, distance: 4, angle: 45, blur: 2, color: '#000000', opacity: 0.5 } as ShapeObject['effects'][number];
    const ed = editorWith([{ ...rect('r', 100, 100, 200, 100), stroke: '#000000', strokeWidth: 10, effects: [shadow] }]);
    ed.select(['r']);
    addGradientMask(ed);
    const g = first(ed).mask!.children[0] as ShapeObject;
    // Reach: stroke 10 + shadow (4 + 2×3) → 20 px each side.
    expect(g.box).toMatchObject({ x: 80, y: 80, width: 240, height: 140 });
  });
});

describe('マスク 第 2 段階', () => {
  it('マスクとして貼り付け: the copied object goes into the mask where it was; an existing mask gets it added', async () => {
    const { copySelection, pasteAsMask } = await import('./actions');
    const ed = editorWith([rect('r', 0, 0, 200, 100), { ...rect('star', 20, 20, 40, 40), fill: '#ffffff' }]);
    ed.select(['star']);
    copySelection(ed);
    ed.select(['r']);
    expect(pasteAsMask(ed)).toBe(true);
    let m = first(ed).mask!;
    expect(m.background).toBe('black');
    expect(m.children).toHaveLength(1);
    expect((m.children[0] as ShapeObject).box).toMatchObject({ x: 20, y: 20, width: 40, height: 40 });
    expect(m.children[0].id).not.toBe('star'); // a copy
    expect(ed.getState().doc.layers[0].children).toHaveLength(2); // the original stays
    pasteAsMask(ed);
    m = first(ed).mask!;
    expect(m.children).toHaveLength(2);
    ed.undo();
    expect(first(ed).mask!.children).toHaveLength(1);
  });

  it('グループでマスク: the top object masks the one below; with more below, a group of them', () => {
    const ed = editorWith([rect('a', 0, 0), rect('b', 50, 0), { ...rect('top', 10, 10, 30, 30), fill: '#ffffff' }]);
    ed.select(['top', 'a']); // order of selection does not matter
    expect(groupAsMask(ed)).toBe(true);
    let kids = ed.getState().doc.layers[0].children;
    expect(kids.map((k) => k.id)).toEqual(['a', 'b']);
    expect(kids[0].mask!.children.map((c) => c.id)).toEqual(['top']);
    expect(ed.getState().selection).toEqual(['a']);
    ed.undo();
    ed.select(['a', 'b', 'top']);
    groupAsMask(ed);
    kids = ed.getState().doc.layers[0].children;
    expect(kids).toHaveLength(1);
    expect(kids[0].type).toBe('group');
    expect((kids[0] as GroupObject).children.map((c) => c.id)).toEqual(['a', 'b']);
    expect(kids[0].mask!.children.map((c) => c.id)).toEqual(['top']);
  });

  it('反転 turns the mask over with a filter, keeping the content', () => {
    const ed = editorWith([rect('r', 10, 10)]);
    ed.select(['r']);
    addGradientMask(ed);
    exitMaskEdit(ed);
    setMask(ed, 'r', { inverted: true }, 'inv');
    const svg = svgOf(ed);
    expect(svg).toContain('id="sp-mask-r-inv"');
    expect(svg).toContain('filter="url(#sp-mask-r-inv)"');
    setMask(ed, 'r', { inverted: false }, 'inv');
    expect(svgOf(ed)).not.toContain('sp-mask-r-inv');
  });

  it('リンク解除: the mask stays put when the object moves; linking again keeps it where it is', () => {
    const ed = editorWith([rect('r', 0, 0)]);
    ed.select(['r']);
    addMask(ed, 'black');
    ed.edit('draw', (d) => addObject(d, d.layers[0].id, { ...rect('w', 10, 10, 20, 20), fill: '#ffffff' }, 'r'));
    exitMaskEdit(ed);
    setMaskLinked(ed, 'r', false);
    expect(first(ed).mask!.linked).toBe(false);
    ed.edit('move', (d) => updateObject(d, 'r', { box: { x: 100, y: 0, width: 100, height: 50, rotation: 0 } }));
    // Drawn from where it is on the canvas: the content's frame is the box itself.
    expect(svgOf(ed)).toContain('scale(1 1) translate(-100 0)');
    setMaskLinked(ed, 'r', true);
    expect(first(ed).mask).toMatchObject({ linked: true, frame: { x: 100 } });
    expect((first(ed).mask!.children[0] as ShapeObject).box.x).toBe(10); // still where it was
  });

  it("an unlinked group's mask does not move with the group", () => {
    const g: GroupObject = { id: 'g', name: 'g', type: 'group', visible: true, locked: false, opacity: 1, children: [rect('a', 0, 0)], mask: { background: 'black', children: [rect('m', 5, 5, 10, 10)], enabled: true, linked: false } };
    const moved = transformObject(g, { ...IDENTITY_TRANSFORM, dx: 50 });
    expect((moved.mask!.children[0] as ShapeObject).box.x).toBe(5);
    expect((moved.children[0] as ShapeObject).box.x).toBe(50);
  });
});
