import { describe, expect, it } from 'vitest';
import { area, traceOutlines } from './trace';

/** A w×h coverage image from a predicate. */
const image = (w: number, h: number, inside: (x: number, y: number) => boolean) => {
  const a = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = inside(x + 0.5, y + 0.5) ? 255 : 0;
  return a;
};

describe('tracing outlines', () => {
  it('a filled square becomes one loop of about its size, with few points', () => {
    const loops = traceOutlines(image(20, 20, (x, y) => x > 5 && x < 15 && y > 5 && y < 15), 20, 20);
    expect(loops).toHaveLength(1);
    expect(Math.abs(area(loops[0]))).toBeGreaterThan(80);
    expect(Math.abs(area(loops[0]))).toBeLessThan(120);
    expect(loops[0].length).toBeLessThanOrEqual(8);
  });

  it('a ring gives an outer loop and a hole (even-odd fills only the ring)', () => {
    const loops = traceOutlines(image(40, 40, (x, y) => Math.hypot(x - 20, y - 20) < 15 && Math.hypot(x - 20, y - 20) > 7), 40, 40);
    expect(loops).toHaveLength(2);
    const areas = loops.map((l) => Math.abs(area(l))).sort((a, b) => a - b);
    expect(areas[0]).toBeGreaterThan(Math.PI * 49 * 0.85);
    expect(areas[0]).toBeLessThan(Math.PI * 49 * 1.15);
    expect(areas[1]).toBeGreaterThan(Math.PI * 225 * 0.9);
    expect(areas[1]).toBeLessThan(Math.PI * 225 * 1.1);
  });

  it('separate shapes, touching the image edge, and tiny specks', () => {
    const loops = traceOutlines(image(30, 10, (x, y) => x < 5 || (x > 10 && x < 20 && y > 2 && y < 8) || (x > 25 && x < 26.2 && y > 5 && y < 6.2)), 30, 10);
    expect(loops).toHaveLength(2); // the 1 px speck is dropped
  });
});
