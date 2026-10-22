import { describe, expect, it } from 'vitest';
import { addCurvePoint, channelTable, defaultCurves, identityCurve, isIdentityCurve, moveCurvePoint, sampleCurve } from './curves';

describe('tone curves', () => {
  it('the identity curve maps every level to itself', () => {
    const s = sampleCurve(identityCurve());
    for (let v = 0; v < 256; v++) expect(s[v]).toBeCloseTo(v, 9);
    expect(isIdentityCurve(identityCurve())).toBe(true);
    expect(isIdentityCurve([{ x: 0, y: 0 }, { x: 128, y: 140 }, { x: 255, y: 255 }])).toBe(false);
  });

  it('passes through the points, never overshoots between them, and is flat beyond the ends', () => {
    const pts = [{ x: 30, y: 10 }, { x: 128, y: 200 }, { x: 140, y: 205 }, { x: 220, y: 240 }];
    const s = sampleCurve(pts);
    for (const p of pts) expect(s[p.x]).toBeCloseTo(p.y, 9);
    for (let v = 0; v <= 30; v++) expect(s[v]).toBe(10);
    for (let v = 220; v < 256; v++) expect(s[v]).toBe(240);
    // Monotone data → monotone curve (a natural spline would bulge past 205 here).
    for (let v = 1; v < 256; v++) expect(s[v]).toBeGreaterThanOrEqual(s[v - 1] - 1e-9);
    for (let v = 128; v <= 140; v++) expect(s[v]).toBeLessThanOrEqual(205 + 1e-9);
  });

  it('applies the channel curve first, then the RGB curve', () => {
    const c = defaultCurves();
    c.r = [{ x: 0, y: 0 }, { x: 255, y: 128 }]; // red halved
    c.rgb = [{ x: 0, y: 255 }, { x: 255, y: 0 }]; // then inverted
    const r = channelTable(c, 'r');
    const g = channelTable(c, 'g');
    expect(r[255]).toBeCloseTo((255 - 128) / 255, 3);
    expect(g[255]).toBeCloseTo(0, 6);
    expect(g[0]).toBeCloseTo(1, 6);
    expect(r).toHaveLength(256);
  });

  it('adds points in order and keeps moved points between their neighbors', () => {
    const added = addCurvePoint(identityCurve(), { x: 100, y: 150 })!;
    expect(added.index).toBe(1);
    expect(added.points.map((p) => p.x)).toEqual([0, 100, 255]);
    expect(addCurvePoint(added.points, { x: 100, y: 20 })).toBeNull(); // same input level
    const moved = moveCurvePoint(added.points, 1, 300, -5);
    expect(moved[1]).toEqual({ x: 254, y: 0 });
    expect(moveCurvePoint(added.points, 0, 50, 20)[0]).toEqual({ x: 50, y: 20 });
    expect(moveCurvePoint(added.points, 0, 150, 20)[0].x).toBe(99);
  });
});
