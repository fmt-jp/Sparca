import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { addObject, groupObjects } from '../model/commands';
import { createShape, defaultGeometry } from '../model/factory';
import { transformObject, IDENTITY_TRANSFORM } from '../model/geometry';
import { objectGradient } from '../model/gradient';
import type { GroupObject, SceneObject, ShapeObject } from '../model/types';
import { DocumentSvg } from '../render/DocumentSvg';
import { EditorStore } from './editor';
import { addGradientMask, canAddMask, removeMask, setMask } from './maskActions';

const rect = (id: string, x: number, y: number): ShapeObject => ({
  ...createShape(defaultGeometry('rect'), { x, y, width: 100, height: 50, rotation: 0 }),
  id,
});

function editorWith(objects: SceneObject[]) {
  const ed = new EditorStore();
  ed.edit('add', (d) => objects.forEach((o) => addObject(d, d.layers[0].id, o)));
  return ed;
}

const svgOf = (ed: EditorStore) => renderToStaticMarkup(createElement(DocumentSvg, { doc: ed.getState().doc, options: { imageHref: () => undefined } }));

describe('グラデーションマスク', () => {
  it('adds a white-to-black linear mask in one undo step, shows its handles, and renders as a luminance mask', () => {
    const ed = editorWith([rect('r', 10, 10)]);
    ed.select(['r']);
    expect(canAddMask(ed)).toBe(true);
    expect(addGradientMask(ed)).toBe(true);
    const o = ed.getState().doc.layers[0].children[0];
    expect(o.mask).toMatchObject({ enabled: true, gradient: { kind: 'linear', stops: [{ color: '#ffffff' }, { color: '#000000' }] } });
    expect(o.mask!.frame).toBeUndefined(); // a leaf's mask follows its box
    expect(ed.getState().gradientTarget).toBe('mask');
    expect(objectGradient(o, 'mask')!.key).toBe('mask');
    const svg = svgOf(ed);
    expect(svg).toContain('<mask id="sp-mask-r"');
    expect(svg).toContain('mask="url(#sp-mask-r)"');
    ed.undo();
    expect(ed.getState().doc.layers[0].children[0].mask).toBeUndefined();
  });

  it('can be switched off (kept but not drawn) and removed', () => {
    const ed = editorWith([rect('r', 10, 10)]);
    ed.select(['r']);
    addGradientMask(ed);
    setMask(ed, 'r', { enabled: false }, 'off');
    expect(ed.getState().doc.layers[0].children[0].mask!.enabled).toBe(false);
    expect(svgOf(ed)).not.toContain('<mask');
    expect(removeMask(ed)).toBe(true);
    expect(ed.getState().doc.layers[0].children[0].mask).toBeUndefined();
  });

  it('wraps the effects too: the mask is outside the filter', () => {
    const ed = editorWith([{ ...rect('r', 10, 10), effects: [{ id: 'e', kind: 'blur', enabled: true, strength: 1, radius: 3 } as ShapeObject['effects'][number]] }]);
    ed.select(['r']);
    addGradientMask(ed);
    const svg = svgOf(ed);
    expect(svg.indexOf('mask="url(#sp-mask-r)"')).toBeLessThan(svg.indexOf('filter="url(#sp-fx-r)"'));
  });

  it('a group gets a frame that moves, scales and turns with it', () => {
    const ed = editorWith([rect('a', 0, 0), rect('b', 200, 100)]);
    let gid = '';
    ed.edit('group', (d) => {
      gid = groupObjects(d, ['a', 'b'])!;
    });
    ed.select([gid]);
    addGradientMask(ed);
    const g = ed.getState().doc.layers[0].children[0] as GroupObject;
    expect(g.mask!.frame).toEqual({ x: 0, y: 0, width: 300, height: 150, rotation: 0 });
    const moved = transformObject(g, { ...IDENTITY_TRANSFORM, dx: 10, dy: 20 });
    expect(moved.mask!.frame).toMatchObject({ x: 10, y: 20, width: 300, height: 150 });
    const turned = transformObject(g, { ...IDENTITY_TRANSFORM, pivot: { x: 150, y: 75 }, rotation: 90 });
    expect(turned.mask!.frame!.rotation).toBe(90);
    expect(svgOf(ed)).toContain(`mask="url(#sp-mask-${gid})"`);
  });

  it('needs exactly one unlocked object', () => {
    const ed = editorWith([rect('a', 0, 0), { ...rect('l', 0, 0), locked: true }]);
    ed.select(['a', 'l']);
    expect(addGradientMask(ed)).toBe(false);
    ed.select(['l']);
    expect(canAddMask(ed)).toBe(false);
  });
});
