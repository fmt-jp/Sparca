import { describe, expect, it } from 'vitest';
import { addObject } from '../model/commands';
import { createEffect } from '../model/effects';
import { createShape, defaultGeometry } from '../model/factory';
import type { SceneObject, ShapeObject } from '../model/types';
import { EditorStore } from './editor';
import { contentBounds, fitCanvasToContent } from './imageActions';

const rect = (id: string, x: number, y: number, w: number, h: number, extra: Partial<ShapeObject> = {}): ShapeObject => ({
  ...createShape(defaultGeometry('rect'), { x, y, width: w, height: h, rotation: 0 }),
  id,
  stroke: null,
  strokeWidth: 0,
  ...extra,
});

function editorWith(objects: SceneObject[]) {
  const ed = new EditorStore();
  ed.edit('add', (d) => objects.forEach((o) => addObject(d, d.layers[0].id, o)));
  return ed;
}

describe('キャンバスを内容に合わせる', () => {
  it('fits the canvas around every visible object, also off the canvas, and moves them in', () => {
    const ed = editorWith([rect('a', -50, 20, 100, 40), rect('b', 300, 500.4, 60, 300)]);
    expect(fitCanvasToContent(ed)).toBe(true);
    const d = ed.getState().doc;
    expect([d.width, d.height]).toEqual([410, 781]);
    const [a, b] = d.layers[0].children as ShapeObject[];
    expect(a.box).toMatchObject({ x: 0, y: 0, width: 100, height: 40 });
    expect(b.box.x).toBe(350);
    expect(b.box.y).toBeCloseTo(480.4);
    // One undo step back to the 800×600 canvas.
    ed.undo();
    expect(ed.getState().doc.width).toBe(800);
    expect((ed.getState().doc.layers[0].children[0] as ShapeObject).box.x).toBe(-50);
  });

  it('counts strokes and effects, but not hidden objects', () => {
    expect(contentBounds([rect('a', 10, 10, 100, 100, { stroke: '#000000', strokeWidth: 10 })])).toEqual({ x: 5, y: 5, width: 110, height: 110 });
    const shadow = { ...createEffect('drop-shadow'), distance: 4, blur: 2 } as ShapeObject['effects'][number];
    expect(contentBounds([rect('a', 10, 10, 100, 100, { effects: [shadow] })])).toEqual({ x: 0, y: 0, width: 120, height: 120 });
    expect(contentBounds([rect('a', 10, 10, 100, 100), rect('h', 500, 500, 10, 10, { visible: false })])).toEqual({ x: 10, y: 10, width: 100, height: 100 });
  });

  it('tells when there is nothing to fit', () => {
    const ed = editorWith([rect('h', 500, 500, 10, 10, { visible: false })]);
    expect(fitCanvasToContent(ed)).toBe(false);
    expect(ed.getState().doc.width).toBe(800);
  });
});
