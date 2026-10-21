import { describe, expect, it } from 'vitest';
import { createText } from '../model/factory';
import { boxCenter, rotatePoint } from '../model/geometry';
import type { TextObject } from '../model/types';
import { fitTextBox, measureText } from './text';

function text(align: TextObject['align'], rotation = 0): TextObject {
  const t = createText('Hello', { x: 100, y: 50, width: 0, height: 0, rotation });
  const m = measureText(t);
  return { ...t, align, box: { ...t.box, width: m.width, height: m.height } };
}

/** Document position of the point at fraction (fx, 0) of the box's top edge. */
const topPoint = (o: TextObject, fx: number) =>
  rotatePoint({ x: o.box.x + o.box.width * fx, y: o.box.y }, boxCenter(o.box), o.box.rotation);

describe('fitTextBox', () => {
  it.each([
    ['left', 0],
    ['center', 0.5],
    ['right', 1],
  ] as const)('keeps the %s alignment point when the font size changes', (align, f) => {
    for (const rotation of [0, 30, -100]) {
      const o = text(align, rotation);
      const bigger = { ...o, fontSize: o.fontSize * 2 };
      const box = fitTextBox(bigger);
      expect(box.width).toBeGreaterThan(o.box.width);
      expect(box.rotation).toBe(rotation);
      const before = topPoint(o, f);
      const after = topPoint({ ...bigger, box }, f);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });

  it('keeps the top-left of unrotated left-aligned text', () => {
    const o = text('left');
    const box = fitTextBox({ ...o, text: 'Hello, world' });
    expect(box).toMatchObject({ x: 100, y: 50 });
  });
});
