import { describe, expect, it } from 'vitest';
import type { LocalStroke } from '../model/types';
import { runPipeline } from './pipeline';
import { createRaster, fillRaster, pixel } from './raster';
import { applyStroke, strokeCoverage } from './stroke';
import { defaultAdjust } from '../model/factory';

const stroke = (p: Partial<LocalStroke>): LocalStroke => ({
  kind: 'stroke',
  tool: 'brush',
  points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
  size: 10,
  hardness: 1,
  color: '#ff0000',
  opacity: 1,
  ...p,
});

describe('brush strokes', () => {
  it('a hard brush paints a round-capped band of its size', () => {
    const out = applyStroke(createRaster(100, 40), stroke({}));
    expect(pixel(out, 50, 20)).toEqual([255, 0, 0, 255]); // on the path
    expect(pixel(out, 50, 16)[3]).toBe(255); // 4 px off, inside the 10 px band
    expect(pixel(out, 50, 27)[3]).toBe(0); // outside
    expect(pixel(out, 5, 20)[3]).toBeGreaterThan(0); // round cap past the end point (x=10)
    expect(pixel(out, 3, 20)[3]).toBe(0);
  });

  it('a soft brush fades towards its edge; opacity and crossing itself do not add up', () => {
    const soft = applyStroke(createRaster(100, 40), stroke({ hardness: 0 }));
    const a = (y: number) => pixel(soft, 50, y)[3];
    expect(a(20)).toBeGreaterThan(a(17));
    expect(a(17)).toBeGreaterThan(a(15));
    expect(a(15)).toBeGreaterThan(0);
    // A stroke going back over itself at 50 %: still 50 %.
    const half = applyStroke(createRaster(100, 40), stroke({ opacity: 0.5, points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { x: 0.1, y: 0.5 }] }));
    expect(pixel(half, 50, 20)[3]).toBe(128);
  });

  it('paints over existing pixels (source-over) and the eraser removes alpha only', () => {
    const blue = fillRaster(createRaster(100, 40), [0, 0, 255, 255]);
    const half = applyStroke(blue, stroke({ opacity: 0.5 }));
    expect(pixel(half, 50, 20)).toEqual([128, 0, 128, 255]);
    const erased = applyStroke(blue, stroke({ tool: 'eraser' }));
    expect(pixel(erased, 50, 20)[3]).toBe(0);
    expect(pixel(erased, 50, 5)).toEqual([0, 0, 255, 255]);
    const partly = applyStroke(blue, stroke({ tool: 'eraser', opacity: 0.25 }));
    expect(pixel(partly, 50, 20)).toEqual([0, 0, 255, 191]);
  });

  it('the pencil draws hard 1 px lines without anti-aliasing', () => {
    const out = applyStroke(createRaster(20, 20), stroke({ tool: 'pencil', size: 1, points: [{ x: 0.1, y: 0.525 }, { x: 0.9, y: 0.525 }] }));
    const col = [9, 10, 11].map((y) => pixel(out, 10, y)[3]);
    expect(col).toEqual([0, 255, 0]);
    for (let i = 3; i < out.data.length; i += 4) expect([0, 255]).toContain(out.data[i]);
    // Exactly on the boundary between two rows: still one row.
    const edge = applyStroke(createRaster(20, 20), stroke({ tool: 'pencil', size: 1, points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] }));
    expect([9, 10, 11].map((y) => pixel(edge, 10, y)[3]).filter((a) => a > 0)).toHaveLength(1);
  });

  it('a pencil line is one pixel thick at any angle, wherever it starts and ends (Bresenham)', () => {
    const W = 200;
    const rows = (out: ReturnType<typeof applyStroke>) => {
      let most = 0;
      for (let y = 0; y < W; y++) {
        let n = 0;
        for (let x = 0; x < W; x++) if (out.data[(y * W + x) * 4 + 3]) n++;
        most = Math.max(most, n);
      }
      return most;
    };
    // 45° lines starting at different places inside a pixel (this one doubled pixels before).
    for (const [x0, y0, x1, y1] of [[10.3, 10.6, 150.9, 151.2], [20.2, 30.7, 120.1, 130.9], [5.5, 5.5, 100.5, 100.5], [150.8, 10.1, 10.2, 150.7]]) {
      const out = applyStroke(createRaster(W, W), stroke({ tool: 'pencil', size: 1, points: [{ x: x0 / W, y: y0 / W }, { x: x1 / W, y: y1 / W }] }));
      expect(rows(out)).toBe(1);
    }
    // A wider pencil stays the same width along a diagonal.
    const wide = applyStroke(createRaster(W, W), stroke({ tool: 'pencil', size: 5, points: [{ x: 10.3 / W, y: 10.6 / W }, { x: 150.9 / W, y: 151.2 / W }] }));
    const counts = new Set<number>();
    for (let y = 30; y < 130; y++) {
      let n = 0;
      for (let x = 0; x < W; x++) if (wide.data[(y * W + x) * 4 + 3]) n++;
      counts.add(n);
    }
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('a stroke drawn with a pixel selection only paints inside it (soft edge fades it)', () => {
    const clipped = applyStroke(createRaster(100, 40), stroke({ clip: { kind: 'rect', x: 0.3, y: 0, width: 0.4, height: 1 } }));
    expect(pixel(clipped, 50, 20)).toEqual([255, 0, 0, 255]); // inside the selection
    expect(pixel(clipped, 20, 20)[3]).toBe(0); // on the stroke, outside the selection
    expect(pixel(clipped, 80, 20)[3]).toBe(0);
    const erased = applyStroke(fillRaster(createRaster(100, 40), [0, 0, 255, 255]), stroke({ tool: 'eraser', clip: { kind: 'ellipse', x: 0.4, y: 0, width: 0.2, height: 1 } }));
    expect(pixel(erased, 50, 20)[3]).toBe(0);
    expect(pixel(erased, 30, 20)[3]).toBe(255);
    const soft = applyStroke(createRaster(100, 40), stroke({ clip: { kind: 'rect', x: 0.3, y: 0, width: 0.4, height: 1, feather: 10 } }));
    expect(pixel(soft, 30, 20)[3]).toBeGreaterThan(50);
    expect(pixel(soft, 30, 20)[3]).toBeLessThan(205);
    expect(pixel(soft, 50, 20)[3]).toBe(255);
    const pencil = applyStroke(createRaster(100, 40), stroke({ tool: 'pencil', size: 1, clip: { kind: 'rect', x: 0.5, y: 0, width: 0.5, height: 1 } }));
    expect(pixel(pencil, 30, 20)[3]).toBe(0);
    expect(pixel(pencil, 70, 20)[3]).toBe(255);
  });

  it('コピースタンプ copies the pixels at its offset (as they were), nothing from outside', () => {
    // Left half red, right half blue; copy from 50 px to the right onto the left half.
    const img = createRaster(100, 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 100; x++) img.data.set(x < 50 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 100 + x) * 4);
    const out = applyStroke(img, stroke({ tool: 'clone', points: [{ x: 0.1, y: 0.5 }, { x: 0.4, y: 0.5 }], offset: { x: 0.5, y: 0 } }));
    expect(pixel(out, 25, 20)).toEqual([0, 0, 255, 255]); // copied blue
    expect(pixel(out, 25, 5)).toEqual([255, 0, 0, 255]); // off the stroke
    // A source outside the image copies nothing.
    const off = applyStroke(img, stroke({ tool: 'clone', points: [{ x: 0.7, y: 0.5 }, { x: 0.9, y: 0.5 }], offset: { x: 0.5, y: 0 } }));
    expect(pixel(off, 80, 20)).toEqual([0, 0, 255, 255]);
    // Half strength: halfway.
    const half = applyStroke(img, stroke({ tool: 'clone', opacity: 0.5, points: [{ x: 0.1, y: 0.5 }, { x: 0.4, y: 0.5 }], offset: { x: 0.5, y: 0 } }));
    expect(pixel(half, 25, 20)).toEqual([128, 0, 128, 255]);
  });

  it('ぼかし and シャープ change the contrast of an edge under the stroke only', () => {
    const img = createRaster(100, 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 100; x++) img.data.set(x < 50 ? [60, 60, 60, 255] : [200, 200, 200, 255], (y * 100 + x) * 4);
    const along = { points: [{ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.8 }], size: 24, opacity: 1, hardness: 1 };
    const blurred = applyStroke(img, stroke({ tool: 'blur', ...along }));
    expect(pixel(blurred, 49, 20)[0]).toBeGreaterThan(70); // the edge softens
    expect(pixel(blurred, 50, 20)[0]).toBeLessThan(190);
    expect(pixel(blurred, 10, 20)[0]).toBe(60); // off the stroke
    const sharp = applyStroke(img, stroke({ tool: 'sharpen', ...along }));
    expect(pixel(sharp, 48, 20)[0]).toBeLessThan(60); // darker on the dark side
    expect(pixel(sharp, 51, 20)[0]).toBeGreaterThan(200); // lighter on the light side
    expect(pixel(sharp, 10, 20)[0]).toBe(60);
  });

  it('覆い焼き lightens and 焼き込み darkens, most in the chosen tones', () => {
    const gray = (v: number) => fillRaster(createRaster(100, 40), [v, v, v, 255]);
    const at = (r: ReturnType<typeof applyStroke>) => pixel(r, 50, 20)[0];
    expect(at(applyStroke(gray(128), stroke({ tool: 'dodge', opacity: 1 })))).toBeGreaterThan(180);
    expect(at(applyStroke(gray(128), stroke({ tool: 'burn', opacity: 1 })))).toBeLessThan(80);
    // Midtones (default) barely touch black; shadows do.
    expect(at(applyStroke(gray(10), stroke({ tool: 'dodge', opacity: 1 })))).toBeLessThan(40);
    expect(at(applyStroke(gray(10), stroke({ tool: 'dodge', opacity: 1, range: 'shadows' })))).toBeGreaterThan(100);
    // Highlights: a light gray darkens more with 焼き込み than a dark one.
    const light = 220 - at(applyStroke(gray(220), stroke({ tool: 'burn', opacity: 1, range: 'highlights' })));
    const dark = 40 - at(applyStroke(gray(40), stroke({ tool: 'burn', opacity: 1, range: 'highlights' })));
    expect(light).toBeGreaterThan(dark * 3);
  });

  it('赤目除去 turns red pixels into dark gray inside the circle; skin, gray and the outside stay', () => {
    const img = createRaster(40, 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) img.data.set(x < 20 ? [210, 30, 40, 255] : [230, 180, 150, 255], (y * 40 + x) * 4);
    img.data.set([128, 128, 128, 255], (20 * 40 + 15) * 4);
    const out = applyStroke(img, stroke({ tool: 'redeye', points: [{ x: 0.5, y: 0.5 }], size: 30, hardness: 1, opacity: 0.5 }));
    const [r, g, b] = pixel(out, 10, 20);
    expect(r).toBeLessThan(60); // no longer red
    expect(Math.abs(r - (g + b) / 2)).toBeLessThan(15); // gray-ish
    expect(pixel(out, 30, 20)).toEqual([230, 180, 150, 255]); // skin tone unchanged
    expect(pixel(out, 15, 20)).toEqual([128, 128, 128, 255]); // gray unchanged
    expect(pixel(out, 1, 1)).toEqual([210, 30, 40, 255]); // outside the circle
    // More strength: darker.
    const dark = applyStroke(img, stroke({ tool: 'redeye', points: [{ x: 0.5, y: 0.5 }], size: 30, hardness: 1, opacity: 1 }));
    expect(pixel(dark, 10, 20)[1]).toBeLessThan(pixel(out, 10, 20)[1]);
  });

  it('coverage of a single click is a round dot', () => {
    const c = strokeCoverage([{ x: 10, y: 10 }], 20, 20, 3, 1, true);
    expect(c[10 * 20 + 10]).toBe(1);
    expect(c[10 * 20 + 14]).toBe(0);
    expect(c[0]).toBe(0);
  });

  it('runs in the image pipeline after the color adjustment, and scales with the preview', () => {
    const src = fillRaster(createRaster(100, 40), [255, 255, 255, 255]);
    const p = { crop: null, resize: null, adjust: { ...defaultAdjust(), brightness: -50 }, localEdits: [stroke({})] };
    const out = runPipeline(src, p);
    expect(pixel(out, 50, 20)).toEqual([255, 0, 0, 255]); // the paint is not darkened
    expect(pixel(out, 50, 5)[0]).toBeLessThan(255); // the photo is
    const small = runPipeline(fillRaster(createRaster(50, 20), [255, 255, 255, 255]), p, 0.5);
    expect(pixel(small, 25, 10)).toEqual([255, 0, 0, 255]);
    expect(pixel(small, 25, 14)[1]).toBeLessThan(255);
  });
});
