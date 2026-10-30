import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { addObject } from '../model/commands';
import { createDocument, createShape, createText, defaultGeometry } from '../model/factory';
import { docContoursToPath, pathContoursToDoc, type DocContour } from '../model/pathEdit';
import type { PathObject, SceneObject } from '../model/types';
import { DocumentSvg } from '../render/DocumentSvg';
import { EditorStore } from './editor';
import { contourCount, deleteSelectedNodes, editablePath, flatPath, insertNode, selectedOutline, setPathNodes } from './pathActions';
import { canCombineSelection, combineSelection, type ComputeBoolean } from './pathCombine';

const square = (x: number, y: number, s: number): DocContour => ({
  closed: true,
  nodes: [
    { anchor: { x, y }, in: null, out: null },
    { anchor: { x: x + s, y }, in: null, out: null },
    { anchor: { x: x + s, y: y + s }, in: null, out: null },
    { anchor: { x, y: y + s }, in: null, out: null },
  ],
});

/** A square with a square hole: a compound path. */
function donut(): PathObject {
  const g = docContoursToPath({ x: 0, y: 0, width: 1, height: 1, rotation: 0 }, [square(0, 0, 100), square(25, 25, 50)]);
  return { id: 'donut', name: 'パス', type: 'path', visible: true, locked: false, opacity: 1, effects: [], fill: '#ff0000', stroke: null, strokeWidth: 0, ...g } as PathObject;
}

function editorWith(objects: SceneObject[]): EditorStore {
  const ed = new EditorStore();
  ed.edit('add', (d) => objects.forEach((o) => addObject(d, d.layers[0].id, o)));
  return ed;
}

describe('compound paths', () => {
  it('keep their outlines through the box refit and render with the even-odd rule', () => {
    const p = donut();
    expect(p.box).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
    expect(p.subpaths).toHaveLength(1);
    const back = pathContoursToDoc(p);
    expect(back[1].nodes[0].anchor).toEqual({ x: 25, y: 25 });
    const doc = createDocument(200, 200);
    doc.layers[0].children = [p];
    const svg = renderToStaticMarkup(createElement(DocumentSvg, { doc, options: { imageHref: () => undefined } }));
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg.match(/M/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('show and edit every outline at once with the subselect tool', () => {
    const ed = editorWith([donut()]);
    ed.select(['donut']);
    expect(contourCount(ed)).toBe(2);
    const p0 = editablePath(ed)!;
    const flat = flatPath(p0);
    // Anchors are numbered across outlines: the outer square 0–3, the hole 4–7.
    expect(flat.nodes).toHaveLength(8);
    expect(flat.contours.map((c) => c.start)).toEqual([0, 4]);
    // Move the hole's first anchor; the outer outline stays.
    setPathNodes(ed, 'donut', flat.nodes.map((n, i) => (i === 4 ? { ...n, anchor: { x: 30, y: 30 } } : n)), 'move');
    const after = pathContoursToDoc(ed.getState().doc.layers[0].children[0] as PathObject);
    expect(after[0].nodes.map((n) => n.anchor)).toEqual(square(0, 0, 100).nodes.map((n) => n.anchor));
    expect(after[1].nodes[0].anchor.x).toBeCloseTo(30);
    // The open / closed toggle and anchor insertion follow the outline of the selected anchor.
    ed.set({ nodeSelection: [5] });
    expect(selectedOutline(ed, editablePath(ed)!)).toBe(1);
    insertNode(ed, 1, 0, 0.5);
    expect(pathContoursToDoc(editablePath(ed)!)[1].nodes).toHaveLength(5);
    expect(pathContoursToDoc(editablePath(ed)!)[0].nodes).toHaveLength(4);
    expect(ed.getState().nodeSelection).toEqual([5]);
    // Deleting every anchor of the hole removes just that outline.
    ed.set({ nodeSelection: [4, 5, 6, 7, 8] });
    expect(deleteSelectedNodes(ed)).toBe(true);
    const p = ed.getState().doc.layers[0].children[0] as PathObject;
    expect(p.subpaths).toBeUndefined();
    expect(p.nodes).toHaveLength(4);
  });
});

describe('パスの結合', () => {
  const rect = () => ({ ...createShape(defaultGeometry('rect'), { x: 0, y: 0, width: 100, height: 100, rotation: 0 }), fill: '#112233', stroke: '#000000', strokeWidth: 2 });
  const circle = () => createShape(defaultGeometry('ellipse'), { x: 50, y: 50, width: 100, height: 100, rotation: 0 });

  it('passes the objects bottom first and puts the result in place of the bottom one', () => {
    const r = rect();
    const c = circle();
    const ed = editorWith([r, c]);
    ed.select([c.id, r.id]); // selection order does not matter
    expect(canCombineSelection(ed)).toBe(true);
    let got: DocContour[][] = [];
    const compute: ComputeBoolean = (objects, op) => {
      got = objects;
      expect(op).toBe('subtract');
      return [square(10, 10, 80), square(30, 30, 20)];
    };
    expect(combineSelection(ed, 'subtract', compute)).toBe(true);
    expect(got).toHaveLength(2);
    expect(got[0][0].nodes).toHaveLength(4); // the rectangle (bottom) first
    expect(got[1][0].nodes).toHaveLength(4); // then the ellipse
    const kids = ed.getState().doc.layers[0].children;
    expect(kids).toHaveLength(1);
    expect(kids[0]).toMatchObject({ id: r.id, type: 'path', fill: '#112233', stroke: '#000000', strokeWidth: 2, box: { x: 10, y: 10, width: 80, height: 80 } });
    expect((kids[0] as PathObject).subpaths).toHaveLength(1);
    expect(ed.getState().selection).toEqual([r.id]);
    expect(ed.getState().history.past.at(-1)!.label).toBe('パスの型抜き');
  });

  it('refuses text and lone objects, and an empty result, without changing anything', () => {
    const r = rect();
    const t = createText('A', { x: 0, y: 0, width: 10, height: 10, rotation: 0 });
    const ed = editorWith([r, t]);
    ed.select([r.id, t.id]);
    expect(canCombineSelection(ed)).toBe(false);
    expect(combineSelection(ed, 'unite', () => [])).toBe(false);
    expect(ed.getState().notices.at(-1)!.message).toContain('閉じた図形とパスだけ');
    ed.select([r.id]);
    expect(canCombineSelection(ed)).toBe(false);
    const c = circle();
    ed.edit('add', (d) => addObject(d, d.layers[0].id, c));
    ed.select([r.id, c.id]);
    const before = ed.getState().doc;
    expect(combineSelection(ed, 'intersect', () => [])).toBe(false);
    expect(ed.getState().notices.at(-1)!.message).toContain('形が残りません');
    expect(ed.getState().doc).toBe(before);
  });

  it('keeps a gradient fill in place on the new box', () => {
    const r = { ...rect(), fill: { kind: 'linear' as const, start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, stops: [{ offset: 0, color: '#000000', opacity: 1 }, { offset: 1, color: '#ffffff', opacity: 1 }] } };
    const c = circle();
    const ed = editorWith([r, c]);
    ed.select([r.id, c.id]);
    combineSelection(ed, 'unite', () => [square(0, 0, 200)]);
    const p = ed.getState().doc.layers[0].children[0] as PathObject;
    expect(p.fill).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 0.5, y: 0 } });
  });
});
