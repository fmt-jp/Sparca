import { describe, expect, it } from 'vitest';
import { defaultAdjust, defaultPipeline } from '../model/factory';
import type { ResampleMethod } from '../model/types';
import { blendWithMask, boxesForGauss, gaussianBlur } from './blur';
import { applyAdjust, computeAutoColor } from './color';
import { rasterizeMask } from './mask';
import { runPipeline } from './pipeline';
import { createRaster, fillRaster, pixel, type Raster } from './raster';
import { keys, lanczos, mitchell, resample } from './resample';

const METHODS: ResampleMethod[] = ['nearest', 'bilinear', 'bicubic', 'lanczos', 'bicubic-sharp', 'bicubic-smooth'];

function gradient(w: number, h: number): Raster {
  const r = createRaster(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      r.data[i] = (x * 255) / (w - 1);
      r.data[i + 1] = (y * 255) / (h - 1);
      r.data[i + 2] = 128;
      r.data[i + 3] = 255;
    }
  return r;
}

function checker(w: number, h: number, cell = 1): Raster {
  const r = createRaster(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? 255 : 0;
      r.data.set([v, v, v, 255], (y * w + x) * 4);
    }
  return r;
}

const mean = (r: Raster, c: number) => {
  let s = 0;
  for (let i = c; i < r.data.length; i += 4) s += r.data[i];
  return s / (r.width * r.height);
};

describe('kernels', () => {
  it('are interpolating or normalized as expected', () => {
    for (const k of [keys(-0.5), keys(-0.75), lanczos(3)]) {
      expect(k.fn(0)).toBeCloseTo(1);
      expect(k.fn(1)).toBeCloseTo(0);
      expect(k.fn(2)).toBeCloseTo(0);
    }
    // Mitchell B=C=1/3 is approximating, not interpolating: k(0) = 8/9.
    expect(mitchell(1 / 3, 1 / 3).fn(0)).toBeCloseTo(8 / 9);
    // Partition of unity at integer offsets for keys
    const k = keys(-0.5);
    expect(k.fn(-1.5) + k.fn(-0.5) + k.fn(0.5) + k.fn(1.5)).toBeCloseTo(1);
  });
});

describe('resample', () => {
  it.each(METHODS)('%s produces the requested size and preserves flat color', (m) => {
    const src = fillRaster(createRaster(37, 23), [200, 100, 50, 255]);
    for (const [w, h] of [[80, 50], [10, 7], [37, 23]] as const) {
      const out = resample(src, w, h, m);
      expect([out.width, out.height]).toEqual([w, h]);
      for (const x of [0, Math.floor(w / 2), w - 1]) expect(pixel(out, x, Math.floor(h / 2))).toEqual([200, 100, 50, 255]);
    }
  });

  it.each(METHODS.filter((m) => m !== 'bicubic-sharp'))('%s keeps the same image at identical size', (m) => {
    const src = gradient(16, 12);
    const out = resample(src, 16, 12, m);
    let maxDiff = 0;
    for (let i = 0; i < src.data.length; i++) maxDiff = Math.max(maxDiff, Math.abs(src.data[i] - out.data[i]));
    // Mitchell is approximating (slight smoothing), the rest are interpolating.
    expect(maxDiff).toBeLessThanOrEqual(m === 'bicubic-smooth' ? 6 : 1);
  });

  it('nearest neighbor duplicates pixels exactly when upscaling 2x', () => {
    const src = checker(4, 4);
    const out = resample(src, 8, 8, 'nearest');
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(pixel(out, x, y)).toEqual(pixel(src, x >> 1, y >> 1));
  });

  it('downscaling averages instead of aliasing (area-correct filter)', () => {
    const src = checker(64, 64);
    for (const m of ['bilinear', 'bicubic', 'lanczos', 'bicubic-smooth'] as const) {
      const out = resample(src, 8, 8, m);
      for (let i = 0; i < out.data.length; i += 4) expect(Math.abs(out.data[i] - 127.5)).toBeLessThan(8);
    }
  });

  it('methods give different results on detail', () => {
    const src = gradient(9, 9);
    src.data.set([255, 255, 255, 255], (4 * 9 + 4) * 4); // a bright dot
    const outs = METHODS.map((m) => resample(src, 31, 31, m));
    const sig = outs.map((o) => pixel(o, 15, 16).join(','));
    expect(new Set(sig).size).toBeGreaterThanOrEqual(5);
  });

  it('sharp variant has more edge contrast than plain bicubic when downscaling', () => {
    const src = createRaster(64, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 64; x++) src.data.set(x < 32 ? [40, 40, 40, 255] : [210, 210, 210, 255], (y * 64 + x) * 4);
    const plain = resample(src, 16, 2, 'bicubic');
    const sharp = resample(src, 16, 2, 'bicubic-sharp');
    const edge = (r: Raster) => pixel(r, 8, 1)[0] - pixel(r, 7, 1)[0];
    expect(edge(sharp)).toBeGreaterThan(edge(plain));
  });

  it('does not bleed color from fully transparent pixels', () => {
    const src = createRaster(4, 1);
    src.data.set([255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0]);
    const out = resample(src, 8, 1, 'bicubic');
    for (let x = 0; x < 8; x++) {
      const [, g, , a] = pixel(out, x, 0);
      if (a > 0) expect(g).toBe(0);
    }
  });
});

describe('color', () => {
  const base = () => fillRaster(createRaster(4, 4), [100, 120, 140, 255]);

  it('identity adjust leaves pixels unchanged', () => {
    expect(applyAdjust(base(), defaultAdjust()).data).toEqual(base().data);
  });

  it('brightness, contrast, saturation and temperature change pixels in the expected direction', () => {
    const b = applyAdjust(base(), { ...defaultAdjust(), brightness: 30 });
    expect(pixel(b, 0, 0)[0]).toBeGreaterThan(100);
    const dark = fillRaster(createRaster(1, 1), [60, 60, 60, 255]);
    expect(pixel(applyAdjust(dark, { ...defaultAdjust(), contrast: 50 }), 0, 0)[0]).toBeLessThan(60);
    const gray = applyAdjust(base(), { ...defaultAdjust(), saturation: -100 });
    const [r, g, bb] = pixel(gray, 0, 0);
    expect(Math.max(r, g, bb) - Math.min(r, g, bb)).toBeLessThanOrEqual(1);
    const warm = applyAdjust(base(), { ...defaultAdjust(), temperature: 50 });
    expect(pixel(warm, 0, 0)[0]).toBeGreaterThan(100);
    expect(pixel(warm, 0, 0)[2]).toBeLessThan(140);
    expect(pixel(warm, 0, 0)[3]).toBe(255);
  });

  it('auto color stretches a low-contrast image and neutralizes a color cast', () => {
    // Low contrast with a blue cast: values in 80..160, blue raised.
    const src = createRaster(32, 32);
    for (let i = 0; i < 32 * 32; i++) {
      const v = 80 + (i % 81);
      src.data.set([v * 0.8, v * 0.9, Math.min(255, v * 1.2), 255], i * 4);
    }
    const params = computeAutoColor(src);
    expect(params.black[0]).toBeGreaterThan(50);
    expect(params.white[2]).toBeLessThan(200);
    const out = applyAdjust(src, { ...defaultAdjust(), auto: params });
    const rng = (r: Raster, c: number) => {
      let lo = 255, hi = 0;
      for (let i = c; i < r.data.length; i += 4) { lo = Math.min(lo, r.data[i]); hi = Math.max(hi, r.data[i]); }
      return hi - lo;
    };
    expect(rng(out, 0)).toBeGreaterThan(rng(src, 0) * 2);
    const means = [0, 1, 2].map((c) => mean(out, c));
    expect(Math.max(...means) - Math.min(...means)).toBeLessThan(8);
  });

  it('auto color balances on near-gray midtones and keeps warm subjects warm', () => {
    // Half a slightly cool gray ramp, half a warm (orange) ramp that dominates the colors.
    const src = createRaster(64, 64);
    for (let i = 0; i < 64 * 64; i++) {
      const v = 30 + ((i >> 1) % 190);
      src.data.set(i % 2 ? [v * 0.95, v, Math.min(255, v * 1.1), 255] : [v, v * 0.62, v * 0.3, 255], i * 4);
    }
    const params = computeAutoColor(src);
    expect(params.gains).toEqual([1, 1, 1]);
    const out = applyAdjust(src, { ...defaultAdjust(), auto: params });
    // A mid gray pixel comes out neutral, an orange one stays orange (gray world would
    // have pushed the whole image toward blue).
    const grayPx = pixel(out, 1 + 2 * 50, 0); // odd index → gray ramp
    expect(Math.abs(grayPx[0] - grayPx[2])).toBeLessThan(10);
    const before = pixel(src, 2 * 50, 0);
    const warm = pixel(out, 2 * 50, 0);
    expect(warm[0] - warm[2]).toBeGreaterThan((before[0] - before[2]) * 0.9);
  });

  it('auto color leaves the balance alone when nothing in the image is near gray', () => {
    const src = createRaster(32, 32);
    // Strong reds, greens and blues only.
    for (let i = 0; i < 32 * 32; i++) {
      const v = 120 + (i % 120);
      const px = [20, 20, 20, 255];
      px[i % 3] = v;
      src.data.set(px, i * 4);
    }
    expect(computeAutoColor(src).gamma).toEqual([1, 1, 1]);
  });

  it('older gray-world auto color settings still render the same', () => {
    const src = gradient(8, 8);
    const old = { black: [0, 0, 0], white: [255, 255, 255], gains: [1, 1, 0.5] } as const;
    const out = applyAdjust(src, { ...defaultAdjust(), auto: { ...old, black: [...old.black], white: [...old.white], gains: [...old.gains] } });
    const [r, , b] = pixel(src, 4, 4);
    expect(pixel(out, 4, 4)[0]).toBe(r);
    expect(pixel(out, 4, 4)[2]).toBe(Math.round(b * 0.5));
  });

  it('auto color result depends on the image (not a fixed preset)', () => {
    const a = computeAutoColor(fillRaster(createRaster(2, 2), [10, 10, 10, 255]));
    const g = gradient(20, 20);
    const b = computeAutoColor(g);
    expect(a).not.toEqual(b);
  });
});

describe('blur', () => {
  it('box widths approximate the requested sigma', () => {
    const boxes = boxesForGauss(10);
    const variance = boxes.reduce((s, w) => s + (w * w - 1) / 12, 0);
    expect(Math.sqrt(variance)).toBeCloseTo(10, 0);
  });

  it.each([1.5, 8])('preserves mean and reduces detail (sigma %s)', (sigma) => {
    const src = checker(32, 32, 2);
    const out = gaussianBlur(src, sigma);
    expect(mean(out, 0)).toBeCloseTo(mean(src, 0), 0);
    let dev = 0;
    for (let i = 0; i < out.data.length; i += 4) dev += Math.abs(out.data[i] - 127.5);
    expect(dev / (32 * 32)).toBeLessThan(60);
  });

  it('sigma 0 is identity', () => {
    const src = gradient(8, 8);
    expect(gaussianBlur(src, 0).data).toEqual(src.data);
  });
});

describe('mask and pipeline', () => {
  it('rasterizes rect masks with anti-aliased edges', () => {
    const m = rasterizeMask({ kind: 'rect', x: 0.25, y: 0, width: 0.5, height: 1 }, 10, 2);
    expect(m[0]).toBe(0);
    expect(m[2]).toBeCloseTo(0.5);
    expect(m[5]).toBe(1);
    expect(m[9]).toBe(0);
  });

  it('rasterizes ellipse and polygon masks', () => {
    const e = rasterizeMask({ kind: 'ellipse', x: 0, y: 0, width: 1, height: 1 }, 20, 20);
    expect(e[10 * 20 + 10]).toBe(1);
    expect(e[0]).toBe(0);
    const total = e.reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(Math.PI * 100, -1);
    const tri = rasterizeMask({ kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }, 10, 10);
    expect(tri.reduce((s, v) => s + v, 0)).toBeCloseTo(50, 0);
  });

  it('blendWithMask only changes covered pixels', () => {
    const a = fillRaster(createRaster(2, 1), [0, 0, 0, 255]);
    const b = fillRaster(createRaster(2, 1), [255, 255, 255, 255]);
    const out = blendWithMask(a, b, new Float32Array([0, 1]));
    expect(pixel(out, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(out, 1, 0)).toEqual([255, 255, 255, 255]);
  });

  it('runs crop → resize → adjust → blur → local blur', () => {
    const src = checker(40, 40, 1);
    const p = {
      ...defaultPipeline(),
      crop: { x: 10, y: 10, width: 20, height: 20 },
      resize: { width: 40, height: 40, method: 'nearest' as const },
      localEdits: [{ kind: 'blur' as const, radius: 3, mask: { kind: 'rect' as const, x: 0, y: 0, width: 0.5, height: 1 } }],
    };
    const out = runPipeline(src, p);
    expect([out.width, out.height]).toEqual([40, 40]);
    // Left half blurred toward gray, right half still crisp black/white.
    expect(Math.abs(pixel(out, 5, 20)[0] - 127)).toBeLessThan(40);
    expect([0, 255]).toContain(pixel(out, 35, 20)[0]);
  });

  it('preview scale produces a proportionally smaller result', () => {
    const src = gradient(20, 20);
    const p = { ...defaultPipeline(), resize: { width: 100, height: 60, method: 'bicubic' as const } };
    const out = runPipeline(src, p, 0.5);
    expect([out.width, out.height]).toEqual([50, 30]);
  });
});
