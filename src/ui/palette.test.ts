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
