import { describe, expect, it } from 'vitest';
import { hasImageExtension, sniffImageFormat, stripImageExtension } from './imageFormats';

const bytes = (...v: (number | string)[]) =>
  new Uint8Array(v.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])).concat(Array(16).fill(0)));

describe('image format sniffing', () => {
  it('recognizes PNG, JPEG, GIF and BMP by content', () => {
    expect(sniffImageFormat(bytes(0x89, 'PNG\r\n\x1a\n'))?.label).toBe('PNG');
    expect(sniffImageFormat(bytes(0xff, 0xd8, 0xff, 0xe0))?.label).toBe('JPEG');
    expect(sniffImageFormat(bytes('GIF87a'))?.label).toBe('GIF');
    expect(sniffImageFormat(bytes('GIF89a'))?.label).toBe('GIF');
    expect(sniffImageFormat(bytes('BM'))?.label).toBe('BMP');
  });

  it('rejects other formats (TIFF, PSD, TGA, ZIP, text)', () => {
    expect(sniffImageFormat(bytes('II*\0'))).toBeNull();
    expect(sniffImageFormat(bytes('MM\0*'))).toBeNull();
    expect(sniffImageFormat(bytes('8BPS'))).toBeNull();
    expect(sniffImageFormat(bytes(0, 0, 2, 0))).toBeNull();
    expect(sniffImageFormat(bytes('PK', 3, 4))).toBeNull();
    expect(sniffImageFormat(bytes('hello'))).toBeNull();
  });

  it('handles extensions from the Fireworks list', () => {
    for (const n of ['a.png', 'b.JPG', 'c.jpe', 'd.jpeg', 'e.gif', 'f.bmp', 'g.dib', 'h.rle']) expect(hasImageExtension(n)).toBe(true);
    expect(hasImageExtension('x.tif')).toBe(false);
    expect(stripImageExtension('写真.JPEG')).toBe('写真');
  });
});
