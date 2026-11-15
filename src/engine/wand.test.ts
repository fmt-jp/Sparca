import { describe, expect, it } from 'vitest';
import { similarRegion } from './wand';

/** A w×h RGBA image from a color function. */
const image = (w: number, h: number, color: (x: number, y: number) => [number, number, number, number]) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(color(x, y), (y * w + x) * 4);
  return d;
};
const count = (m: Uint8ClampedArray) => m.reduce((n, v) => n + (v ? 1 : 0), 0);

describe('自動選択', () => {
  // Two red squares (one slightly darker) on white, apart.
  const img = image(30, 10, (x, y) => (x >= 2 && x < 8 && y >= 2 && y < 8 ? [220, 20, 20, 255] : x >= 20 && x < 26 && y >= 2 && y < 8 ? [200, 30, 25, 255] : [255, 255, 255, 255]));

  it('takes the connected pixels within the tolerance', () => {
    expect(count(similarRegion(img, 30, 10, 4, 4, 32, true))).toBe(36);
    expect(count(similarRegion(img, 30, 10, 0, 0, 32, true))).toBe(300 - 72); // the white around
  });

  it('without 隣接 it takes like colors anywhere; the tolerance decides what is alike', () => {
    expect(count(similarRegion(img, 30, 10, 4, 4, 32, false))).toBe(72);
    expect(count(similarRegion(img, 30, 10, 4, 4, 10, false))).toBe(36); // the darker red is 20 off
    expect(count(similarRegion(img, 30, 10, 4, 4, 0, true))).toBe(36);
  });

  it('transparency counts: clear pixels are not like opaque ones', () => {
    const t = image(4, 1, (x) => (x < 2 ? [0, 0, 0, 0] : [0, 0, 0, 255]));
    expect(count(similarRegion(t, 4, 1, 0, 0, 32, true))).toBe(2);
    expect(count(similarRegion(t, 4, 1, -1, 0, 32, true))).toBe(0);
  });
});
