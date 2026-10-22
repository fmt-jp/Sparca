import { describe, expect, it } from 'vitest';
import { cssFontFamily, fontLabel, GENERIC_FAMILIES } from './fonts';

describe('fonts', () => {
  it('quotes family names and adds a generic fallback; generic names stay as they are', () => {
    expect(cssFontFamily('Yu Gothic')).toBe('"Yu Gothic", sans-serif');
    expect(cssFontFamily('3D "Font"')).toBe('"3D Font", sans-serif');
    for (const g of GENERIC_FAMILIES) expect(cssFontFamily(g)).toBe(g);
  });

  it('shows Japanese names for well-known fonts and the family name otherwise', () => {
    expect(fontLabel('Meiryo')).toBe('メイリオ');
    expect(fontLabel('serif')).toBe('明朝体（標準）');
    expect(fontLabel('Some Font')).toBe('Some Font');
  });
});
