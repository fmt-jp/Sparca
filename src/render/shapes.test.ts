import { describe, expect, it } from 'vitest';
import { arrowTipAngle, blockArrowPoints, headForTipAngle, shapePaths } from './shapes';

describe('block arrow', () => {
  it('builds a closed 7-point outline with the tip at the right middle', () => {
    const pts = blockArrowPoints(0.5, 0.4, 200, 100);
    expect(pts).toHaveLength(7);
    expect(pts[3]).toEqual({ x: 200, y: 50 }); // tip
    expect(pts[0]).toEqual({ x: 0, y: 25 }); // shaft is half the height
    expect(pts[6]).toEqual({ x: 0, y: 75 });
    expect(pts[1].x).toBeCloseTo(120); // head is 40% of the length
    expect(pts[2]).toEqual({ x: pts[1].x, y: 0 }); // head spans the full height
    const p = shapePaths({ kind: 'block-arrow', shaft: 0.5, head: 0.4 }, 200, 100, 4);
    expect(p.open).toBe(false); // filled like other shapes
    expect(p.d.endsWith('Z')).toBe(true);
  });

  it('converts between tip angle and head length', () => {
    // Head 50px long, 100px wide → tip angle 2·atan(50/50) = 90°.
    expect(arrowTipAngle(50, 100)).toBeCloseTo(90);
    const head = headForTipAngle(60, 200, 100);
    expect(arrowTipAngle(head * 200, 100)).toBeCloseTo(60);
  });
});
