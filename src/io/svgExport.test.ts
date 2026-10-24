import { describe, expect, it } from 'vitest';
import { createEffect } from '../model/effects';
import { createDocument, createShape, defaultGeometry } from '../model/factory';
import type { SceneObject } from '../model/types';
import { canvasContent } from './svgExport';

const rect = (x: number, y: number, extra: Partial<SceneObject> = {}) =>
  ({ ...createShape(defaultGeometry('rect'), { x, y, width: 20, height: 20, rotation: 0 }), ...extra }) as SceneObject;

describe('SVG export content', () => {
  it('leaves out hidden layers / objects and objects that cannot reach the canvas', () => {
    const doc = createDocument(100, 100);
    const inside = rect(10, 10);
    const outside = rect(300, 10);
    const hidden = rect(10, 10, { visible: false });
    // Just outside, but its drop shadow reaches in.
    const plain = rect(104, 10);
    const shadowed = rect(104, 10, { effects: [{ ...createEffect('drop-shadow'), distance: 5, blur: 2 }] } as Partial<SceneObject>);
    doc.layers[0].children = [inside, outside, hidden, plain, shadowed];
    doc.layers.push({ id: 'l2', name: 'hidden', visible: false, locked: false, children: [rect(0, 0)] });
    const out = canvasContent(doc);
    expect(out.layers).toHaveLength(1);
    expect(out.layers[0].children.map((o) => o.id)).toEqual([inside.id, shadowed.id]);
    // The document itself is not changed.
    expect(doc.layers[0].children).toHaveLength(5);
  });

  it('keeps groups with something on the canvas and drops empty ones', () => {
    const doc = createDocument(100, 100);
    const a = rect(10, 10);
    const b = rect(500, 500);
    doc.layers[0].children = [
      { id: 'g1', name: 'g1', type: 'group', visible: true, locked: false, opacity: 1, children: [a, b] },
      { id: 'g2', name: 'g2', type: 'group', visible: true, locked: false, opacity: 1, children: [rect(400, 400)] },
    ];
    const out = canvasContent(doc).layers[0].children;
    expect(out.map((o) => o.id)).toEqual(['g1']);
    expect((out[0] as { children: SceneObject[] }).children.map((o) => o.id)).toEqual([a.id]);
  });
});
