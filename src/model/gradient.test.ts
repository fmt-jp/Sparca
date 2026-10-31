import { describe, expect, it } from 'vitest';
import {
  colorAt,
  docToNormalized,
  gradientAngle,
  normalizedToDoc,
  objectGradient,
  representativeColor,
  reversed,
  toGradient,
  withAngle,
} from './gradient';
import { createShape, createText, defaultGeometry } from './factory';
import type { Gradient } from './types';

const g2 = (kind: Gradient['kind'] = 'linear'): Gradient => ({
  kind,
  start: { x: 0, y: 0.5 },
  end: { x: 1, y: 0.5 },
  stops: [
    { offset: 1, color: '#ffffff', opacity: 0 },
    { offset: 0, color: '#000000', opacity: 1 },
  ],
});

describe('gradient model', () => {
  it('derives a gradient from the current fill and back', () => {
    const g = toGradient('linear', '#ff0000');
    expect(g.stops.map((s) => s.color)).toEqual(['#ff0000', '#ffffff']);
    expect(toGradient('radial', null).stops.map((s) => s.color)).toEqual(['#ffffff', '#000000']);
    // Changing the kind keeps the colors.
    const r = toGradient('conic', g);
    expect(r.kind).toBe('conic');
    expect(r.stops).toEqual(g.stops);
    expect(representativeColor(g)).toBe('#ff0000');
    expect(representativeColor('#123456')).toBe('#123456');
  });

  it('interpolates color and opacity between stops in any stored order', () => {
    const g = g2();
    expect(colorAt(g.stops, 0.5)).toEqual({ color: '#808080', opacity: 0.5 });
    expect(colorAt(g.stops, -1)).toEqual({ color: '#000000', opacity: 1 });
    expect(colorAt(g.stops, 2)).toEqual({ color: '#ffffff', opacity: 0 });
  });

  it('measures and sets the on-screen angle for non-square boxes', () => {
    const g = { ...g2(), start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
    // 200×100 box: the diagonal is at atan(100/200).
    expect(gradientAngle(g, 200, 100)).toBeCloseTo((Math.atan2(100, 200) * 180) / Math.PI, 6);
    const turned = withAngle(g, 90, 200, 100);
    expect(gradientAngle(turned, 200, 100)).toBeCloseTo(90, 6);
    // Linear turns about its midpoint, keeping its length on screen.
    expect((turned.start.x + turned.end.x) / 2).toBeCloseTo(0.5, 6);
    expect((turned.start.y + turned.end.y) / 2).toBeCloseTo(0.5, 6);
    expect(Math.hypot((turned.end.x - turned.start.x) * 200, (turned.end.y - turned.start.y) * 100)).toBeCloseTo(Math.hypot(200, 100), 6);
    // Conic turns about its center.
    const c = withAngle({ ...g, kind: 'conic' }, 180, 200, 100);
    expect(c.start).toEqual(g.start);
    expect(gradientAngle(c, 200, 100)).toBeCloseTo(180, 6);
  });

  it('reverses the color order', () => {
    expect(reversed(g2()).stops.map((s) => [s.offset, s.color])).toEqual([
      [0, '#ffffff'],
      [1, '#000000'],
    ]);
  });

  it('maps handles between the rotated box and normalized coordinates', () => {
    const box = { x: 10, y: 20, width: 200, height: 100, rotation: 30 };
    for (const p of [{ x: 0, y: 0 }, { x: 0.25, y: 0.8 }, { x: 1.2, y: -0.3 }]) {
      const back = docToNormalized(box, normalizedToDoc(box, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
    // The box center stays put under rotation.
    expect(normalizedToDoc(box, { x: 0.5, y: 0.5 })).toEqual({ x: 110, y: 70 });
  });

  it('finds the gradient an object shows', () => {
    const rect = createShape(defaultGeometry('rect'), { x: 0, y: 0, width: 10, height: 10, rotation: 0 });
    expect(objectGradient(rect)).toBeNull();
    rect.fill = g2();
    expect(objectGradient(rect)?.key).toBe('fill');
    const t = createText('a', { x: 0, y: 0, width: 10, height: 10, rotation: 0 });
    t.color = g2('radial');
    expect(objectGradient(t)?.key).toBe('color');
    // Lines have no fill area.
    const line = createShape(defaultGeometry('line'), { x: 0, y: 0, width: 10, height: 10, rotation: 0 });
    line.fill = g2();
    expect(objectGradient(line)).toBeNull();
  });
});

describe('stroke gradients', () => {
  it('objectGradient finds the stroke gradient and prefers the requested one', () => {
    const g = toGradient('linear', '#ff0000');
    const shape = { ...createShape(defaultGeometry('rect'), { x: 0, y: 0, width: 10, height: 10, rotation: 0 }), fill: g, stroke: g, strokeWidth: 2 };
    expect(objectGradient(shape)!.key).toBe('fill');
    expect(objectGradient(shape, 'stroke')!.key).toBe('stroke');
    expect(objectGradient({ ...shape, fill: '#000000' })!.key).toBe('stroke');
    expect(objectGradient({ ...shape, fill: '#000000', strokeWidth: 0 })).toBeNull();
    const line = { ...createShape(defaultGeometry('line'), { x: 0, y: 0, width: 10, height: 10, rotation: 0 }), stroke: g, strokeWidth: 3 };
    expect(objectGradient(line)!.key).toBe('stroke');
  });

  it('a pattern is not a gradient, and its color stands in for it', () => {
    const p = { kind: 'pattern' as const, motif: 'dots' as const, color: '#00ff00', background: null, size: 10, angle: 0, weight: 0.5 };
    expect(representativeColor(p)).toBe('#00ff00');
    expect(toGradient('linear', p).stops[0].color).toBe('#00ff00');
  });
});
