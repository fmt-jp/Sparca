import { describe, expect, it } from 'vitest';
import { addObject } from '../model/commands';
import { createShape, createText, defaultGeometry } from '../model/factory';
import type { PathObject, TextObject } from '../model/types';
import { layoutTextOnPath } from '../render/textOnPath';
import { EditorStore } from './editor';
import { attachTextToPath, canAttachTextToPath, canDetachTextFromPath, detachTextFromPath } from './textPathActions';

/** Translation and rotation of a glyph transform like "translate(10 20) rotate(30)". */
function parse(t: string) {
  const [x, y] = t.match(/translate\(([-\d.]+) ([-\d.]+)\)/)!.slice(1).map(Number);
  const rot = t.match(/rotate\(([-\d.]+)\)/);
  return { x, y, rotate: rot ? Number(rot[1]) : null, skewX: /skewX/.test(t), skewY: /skewY/.test(t) };
}

/** Text on a straight horizontal path from (0, 50) to (200, 50) in a 200 × 100 box. */
function onLine(patch: Partial<TextObject> = {}, path: Partial<NonNullable<TextObject['path']>> = {}): TextObject {
  return {
    ...createText('ABCD', { x: 0, y: 0, width: 200, height: 100, rotation: 0 }),
    fontSize: 20, // estimated 12 px per character outside the browser
    ...patch,
    path: {
      nodes: [
        { anchor: { x: 0, y: 0.5 }, in: null, out: null },
        { anchor: { x: 1, y: 0.5 }, in: null, out: null },
      ],
      closed: false,
      offset: 0,
      orientation: 'rotate',
      reverse: false,
      shift: 0,
      source: { name: 'パス', fill: null, stroke: '#000000', strokeWidth: 1, opacity: 1, effects: [] },
      ...path,
    },
  };
}

describe('text on a path layout', () => {
  it('places characters along the path, turned with it, from the start offset by the alignment', () => {
    const g = layoutTextOnPath(onLine()).map((x) => parse(x.transform));
    expect(g.map((p) => p.x)).toEqual([6, 18, 30, 42]);
    expect(g.every((p) => p.y === 50 && p.rotate === 0)).toBe(true);
    // Centered on the middle of the path.
    const c = layoutTextOnPath(onLine({ align: 'center' }, { offset: 0.5 })).map((x) => parse(x.transform).x);
    expect(c).toEqual([82, 94, 106, 118]);
    // Letter spacing widens the gaps.
    expect(layoutTextOnPath(onLine({ letterSpacing: 4 })).map((x) => parse(x.transform).x)).toEqual([6, 22, 38, 54]);
  });

  it('reverse runs the other way (upside down here), shift lifts the baseline, open ends drop letters', () => {
    const r = layoutTextOnPath(onLine({}, { reverse: true })).map((x) => parse(x.transform));
    expect(r[0].x).toBeCloseTo(194);
    expect(Math.abs(r[0].rotate!)).toBeCloseTo(180);
    expect(layoutTextOnPath(onLine({}, { shift: 10 })).map((x) => parse(x.transform).y)).toEqual([40, 40, 40, 40]);
    // Starting near the end of an open path: only what fits is drawn.
    expect(layoutTextOnPath(onLine({}, { offset: 0.9 }))).toHaveLength(2);
    // Spaces take room but draw nothing.
    expect(layoutTextOnPath(onLine({ text: 'A B' }))).toHaveLength(2);
  });

  it('orientations: upright, skewed vertically or horizontally', () => {
    const slope = (o: TextObject['path'] extends infer P ? Partial<NonNullable<P>> : never) =>
      layoutTextOnPath(
        onLine({}, {
          ...o,
          nodes: [
            { anchor: { x: 0, y: 1 }, in: null, out: null },
            { anchor: { x: 1, y: 0 }, in: null, out: null },
          ],
        }),
      ).map((x) => parse(x.transform));
    expect(slope({ orientation: 'rotate' })[0].rotate).toBeLessThan(0);
    expect(slope({ orientation: 'vertical' })[0]).toMatchObject({ rotate: null, skewX: false, skewY: false });
    expect(slope({ orientation: 'skew-vertical' })[0].skewY).toBe(true);
    expect(slope({ orientation: 'skew-horizontal' })[0].skewX).toBe(true);
  });
});

describe('テキストをパスに添付', () => {
  it('turns a text and a shape into one text on the path, and back again', () => {
    const ed = new EditorStore();
    const circle = { ...createShape(defaultGeometry('ellipse'), { x: 100, y: 100, width: 200, height: 200, rotation: 0 }), stroke: '#ff0000', strokeWidth: 3 };
    const text = createText('HANABI', { x: 0, y: 0, width: 80, height: 30, rotation: 0 });
    ed.edit('add', (d) => {
      addObject(d, d.layers[0].id, circle);
      addObject(d, d.layers[0].id, text);
    });
    ed.select([text.id]);
    expect(canAttachTextToPath(ed)).toBe(false);
    ed.select([circle.id, text.id]);
    expect(canAttachTextToPath(ed)).toBe(true);
    expect(attachTextToPath(ed)).toBe(true);
    let kids = ed.getState().doc.layers[0].children;
    expect(kids).toHaveLength(1);
    const t = kids[0] as TextObject;
    expect(t).toMatchObject({ id: text.id, type: 'text', box: circle.box, path: { closed: true, offset: 0, orientation: 'rotate', reverse: false, shift: 0, source: { stroke: '#ff0000', strokeWidth: 3 } } });
    expect(t.path!.nodes).toHaveLength(4);
    expect(ed.getState().history.past.at(-1)!.label).toBe('テキストをパスに添付');
    expect(canDetachTextFromPath(ed)).toBe(true);

    expect(detachTextFromPath(ed)).toBe(true);
    kids = ed.getState().doc.layers[0].children;
    expect(kids.map((o) => o.type)).toEqual(['path', 'text']);
    expect(kids[0] as PathObject).toMatchObject({ box: circle.box, closed: true, stroke: '#ff0000', strokeWidth: 3 });
    expect((kids[1] as TextObject).path).toBeUndefined();
    expect((kids[1] as TextObject).box.x).toBeCloseTo(100);
    expect((kids[1] as TextObject).box.y).toBeCloseTo(100);
    expect(ed.getState().selection).toEqual([text.id, kids[0].id]);
  });
});
