import { describe, expect, it } from 'vitest';
import { createShape, createText, defaultGeometry } from './factory';
import { flipObject } from './flip';
import type { GroupObject, ImageObject, PathObject, ShapeObject } from './types';

const box = (x: number, y: number, w = 100, h = 50, rotation = 0) => ({ x, y, width: w, height: h, rotation });
const shape = (kind: Parameters<typeof defaultGeometry>[0], b = box(0, 0)): ShapeObject => ({ ...createShape(defaultGeometry(kind), b), id: kind });
const path: PathObject = {
  ...shape('rect'),
  id: 'p',
  type: 'path',
  closed: true,
  nodes: [
    { anchor: { x: 0, y: 0 }, in: null, out: { x: 0.2, y: 0 } },
    { anchor: { x: 1, y: 0.5 }, in: null, out: null },
    { anchor: { x: 0, y: 1 }, in: null, out: null },
  ],
} as unknown as PathObject;

describe('左右反転・上下反転', () => {
  it('mirrors a path around the line through c, its outline included; twice gives it back', () => {
    const p = { ...path, box: box(10, 20) };
    const f = flipObject(p, 'x', { x: 200, y: 0 }) as PathObject;
    expect(f.box).toMatchObject({ x: 290, y: 20, rotation: 0 }); // 10..110 → 290..390
    expect(f.nodes.map((n) => n.anchor)).toEqual([{ x: 1, y: 0 }, { x: 0, y: 0.5 }, { x: 1, y: 1 }]);
    expect(f.nodes[0].out).toEqual({ x: 0.8, y: 0 });
    const back = flipObject(f, 'x', { x: 200, y: 0 }) as PathObject;
    expect(back.box).toEqual(p.box);
    expect(back.nodes.map((n) => n.anchor)).toEqual(p.nodes.map((n) => n.anchor));
    expect(back.nodes[0].out!.x).toBeCloseTo(0.2, 10);
  });

  it('a rotated object turns the other way', () => {
    const r = flipObject({ ...shape('rect'), box: box(0, 0, 100, 50, 30) }, 'x', { x: 50, y: 25 });
    expect(r.type !== 'group' && r.box.rotation).toBe(-30);
  });

  it('a star flipped top–bottom points down (a half turn); left–right it stays', () => {
    const s = shape('star');
    expect((flipObject(s, 'x', { x: 50, y: 25 }) as ShapeObject).box.rotation).toBe(0);
    expect(Math.abs((flipObject(s, 'y', { x: 50, y: 25 }) as ShapeObject).box.rotation)).toBe(180);
    // A block arrow pointing right points left after 左右反転.
    expect(Math.abs((flipObject(shape('block-arrow'), 'x', { x: 50, y: 25 }) as ShapeObject).box.rotation)).toBe(180);
  });

  it('a line mirrors its ends; a gradient fill turns around with the shape', () => {
    const line = { ...shape('line'), shape: { kind: 'line' as const, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } } };
    const f = flipObject(line, 'x', { x: 50, y: 25 }) as ShapeObject;
    expect(f.shape).toMatchObject({ from: { x: 1, y: 0 }, to: { x: 0, y: 1 } });
    const grad = { kind: 'linear' as const, start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 }, stops: [] };
    const g = flipObject({ ...shape('rect'), fill: grad }, 'x', { x: 50, y: 25 }) as ShapeObject;
    expect(g.fill).toMatchObject({ start: { x: 1, y: 0.5 }, end: { x: 0, y: 0.5 } });
  });

  it('images and text record the mirror (twice removes it); text stays text', () => {
    const img = { ...shape('rect'), id: 'i', type: 'image', assetId: 'a', pipeline: {} } as unknown as ImageObject;
    const once = flipObject(img, 'y', { x: 50, y: 25 }) as ImageObject;
    expect(once.flip).toEqual({ x: false, y: true });
    expect('flip' in (flipObject(once, 'y', { x: 50, y: 25 }) as ImageObject)).toBe(false);
    const t = flipObject({ ...createText('あいう', box(0, 0)), id: 't' }, 'x', { x: 50, y: 25 });
    expect(t).toMatchObject({ type: 'text', text: 'あいう', flip: { x: true, y: false } });
  });

  it('a group mirrors its members around the common center (they swap places)', () => {
    const g: GroupObject = { id: 'g', name: 'g', type: 'group', visible: true, locked: false, opacity: 1, children: [shape('rect', box(0, 0)), shape('ellipse', box(200, 0))] };
    const f = flipObject(g, 'x', { x: 150, y: 25 }) as GroupObject;
    expect(f.children.map((c) => (c.type === 'group' ? null : c.box.x))).toEqual([200, 0]);
  });

  it('the mask layer is mirrored with its object', () => {
    const inMask = shape('ellipse', box(0, 0, 20, 20));
    const r = { ...shape('rect', box(0, 0, 100, 50)), mask: { background: 'black' as const, children: [inMask], frame: box(0, 0, 100, 50), enabled: true } };
    const f = flipObject(r, 'x', { x: 50, y: 25 }) as ShapeObject;
    expect(f.mask!.children[0]).toMatchObject({ box: { x: 80, y: 0 } });
    expect(f.mask!.frame).toEqual(f.box);
  });
});
