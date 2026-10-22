import { describe, expect, it } from 'vitest';
import { japaneseFamilyName } from './fontNames';
import { buildTestCollection, buildTestFont } from './testFont';

const EN = 0x0409;
const JA = 0x0411;
const blob = (b: Uint8Array) => new Blob([b as BlobPart]);

describe('Japanese font names', () => {
  it('reads the Japanese family name, preferring the typographic family', async () => {
    const f = buildTestFont([
      { id: 1, language: EN, text: 'AR Itaitai E' },
      { id: 1, language: JA, text: 'AR板体E' },
      { id: 6, language: EN, text: 'ARItaitaiE' },
    ]);
    expect(await japaneseFamilyName(blob(f))).toBe('AR板体E');
    const typo = buildTestFont([
      { id: 1, language: JA, text: '游ゴシック Light' },
      { id: 16, language: JA, text: '游ゴシック' },
    ]);
    expect(await japaneseFamilyName(blob(typo))).toBe('游ゴシック');
  });

  it('returns null for fonts without a Japanese name or unreadable files', async () => {
    expect(await japaneseFamilyName(blob(buildTestFont([{ id: 1, language: EN, text: 'Arial' }])))).toBeNull();
    expect(await japaneseFamilyName(blob(new Uint8Array([1, 2, 3])))).toBeNull();
  });

  it('picks the matching font in a collection (.ttc) by PostScript name', async () => {
    const ttc = buildTestCollection([
      [
        { id: 6, language: EN, text: 'MS-Gothic' },
        { id: 1, language: JA, text: 'ＭＳ ゴシック' },
      ],
      [
        { id: 6, language: EN, text: 'MS-PGothic' },
        { id: 1, language: JA, text: 'ＭＳ Ｐゴシック' },
      ],
    ]);
    expect(await japaneseFamilyName(blob(ttc), 'MS-PGothic')).toBe('ＭＳ Ｐゴシック');
    expect(await japaneseFamilyName(blob(ttc), 'MS-Gothic')).toBe('ＭＳ ゴシック');
    expect(await japaneseFamilyName(blob(ttc))).toBe('ＭＳ ゴシック'); // no name given: the first
  });
});
