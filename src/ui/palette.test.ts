import { describe, expect, it } from 'vitest';
import { BASIC_COLORS, parseHex, webSafeGrid } from './palette';

describe('swatch palette', () => {
  it('has all 216 web-safe colors exactly once in a 12 × 18 grid', () => {
    const grid = webSafeGrid();
    expect(grid).toHaveLength(12);
    expect(grid.every((r) => r.length === 18)).toBe(true);
    const all = grid.flat();
    expect(new Set(all).size).toBe(216);
    expect(all.every((c) => /^#(00|33|66|99|cc|ff){3}$/.test(c))).toBe(true);
    expect(BASIC_COLORS).toContain('#ffffff');
  });

  it('parses hex codes in the usual forms', () => {
    expect(parseHex('#C8C8C8')).toBe('#c8c8c8');
    expect(parseHex('c8c8c8')).toBe('#c8c8c8');
    expect(parseHex('#f0a')).toBe('#ff00aa');
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('red')).toBeNull();
  });
});

import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from './palette';

describe('color conversion', () => {
  it('round-trips hex ↔ rgb ↔ hsv', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#c8c8c8', '#ff6600', '#123456', '#abcdef']) {
      const [r, g, b] = hexToRgb(hex);
      expect(rgbToHex(r, g, b)).toBe(hex);
      const back = hsvToRgb(rgbToHsv(r, g, b));
      expect(rgbToHex(...back)).toBe(hex);
    }
  });

  it('gives the expected hue, saturation and value', () => {
    expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv(0, 0, 255).h).toBeCloseTo(240);
    expect(rgbToHsv(128, 128, 128).s).toBe(0);
    expect(hsvToRgb({ h: 120, s: 1, v: 1 })).toEqual([0, 255, 0]);
  });
});
