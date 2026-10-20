// Image resampling with selectable interpolation (spec §7.2, docs/design.md §4.1).
// Separable convolution: horizontal pass into a float buffer, then vertical pass.
// Filters are widened by the reduction factor when downscaling (area-correct, no aliasing).
// Colors are filtered premultiplied by alpha so transparent pixels don't bleed their color.
import type { ResampleMethod } from '../model/types';
import { gaussianBlur } from './blur';
import { createRaster, type Raster } from './raster';

export interface Kernel {
  radius: number;
  fn: (x: number) => number;
}

export const triangle: Kernel = { radius: 1, fn: (x) => Math.max(0, 1 - Math.abs(x)) };

/** Keys cubic convolution kernel with parameter a (a=-0.5: Catmull-Rom-like "bicubic"). */
export function keys(a: number): Kernel {
  return {
    radius: 2,
    fn: (t) => {
      const x = Math.abs(t);
      if (x < 1) return (a + 2) * x ** 3 - (a + 3) * x ** 2 + 1;
      if (x < 2) return a * x ** 3 - 5 * a * x ** 2 + 8 * a * x - 4 * a;
      return 0;
    },
  };
}

/** Mitchell–Netravali family; B=C=1/3 is the recommended smooth filter. */
export function mitchell(B: number, C: number): Kernel {
  return {
    radius: 2,
    fn: (t) => {
      const x = Math.abs(t);
      if (x < 1) return ((12 - 9 * B - 6 * C) * x ** 3 + (-18 + 12 * B + 6 * C) * x ** 2 + (6 - 2 * B)) / 6;
      if (x < 2) return ((-B - 6 * C) * x ** 3 + (6 * B + 30 * C) * x ** 2 + (-12 * B - 48 * C) * x + (8 * B + 24 * C)) / 6;
      return 0;
    },
  };
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const p = Math.PI * x;
  return Math.sin(p) / p;
}

export function lanczos(lobes: number): Kernel {
  return { radius: lobes, fn: (x) => (Math.abs(x) < lobes ? sinc(x) * sinc(x / lobes) : 0) };
}

/** Parameters of each method; documented in docs/design.md §4.1. */
export const METHOD_PARAMS = {
  bicubic: { a: -0.5 },
  bicubicSharp: { a: -0.75, unsharpSigma: 0.8, unsharpAmount: 0.5 },
  bicubicSmooth: { B: 1 / 3, C: 1 / 3 },
  lanczos: { lobes: 3 },
} as const;

export function kernelFor(method: ResampleMethod): Kernel | null {
  switch (method) {
    case 'nearest':
      return null;
    case 'bilinear':
      return triangle;
    case 'bicubic':
      return keys(METHOD_PARAMS.bicubic.a);
    case 'bicubic-sharp':
      return keys(METHOD_PARAMS.bicubicSharp.a);
    case 'bicubic-smooth':
      return mitchell(METHOD_PARAMS.bicubicSmooth.B, METHOD_PARAMS.bicubicSmooth.C);
    case 'lanczos':
      return lanczos(METHOD_PARAMS.lanczos.lobes);
  }
}

interface Weights {
  /** For each output index: first source index and its weights. */
  start: Int32Array;
  count: Int32Array;
  weights: Float32Array;
  stride: number;
}

function computeWeights(inSize: number, outSize: number, k: Kernel): Weights {
  const scale = outSize / inSize;
  const filterScale = Math.max(1, 1 / scale);
  const support = k.radius * filterScale;
  const stride = Math.ceil(support) * 2 + 2;
  const start = new Int32Array(outSize);
  const count = new Int32Array(outSize);
  const weights = new Float32Array(outSize * stride);
  for (let i = 0; i < outSize; i++) {
    const center = (i + 0.5) / scale - 0.5;
    const lo = Math.ceil(center - support);
    const hi = Math.floor(center + support);
    // Accumulate weights for clamped (edge-extended) indices.
    const first = Math.max(0, Math.min(inSize - 1, lo));
    const last = Math.max(0, Math.min(inSize - 1, hi));
    const n = last - first + 1;
    let sum = 0;
    const base = i * stride;
    for (let j = lo; j <= hi; j++) {
      const w = k.fn((j - center) / filterScale);
      if (w === 0) continue;
      const jj = Math.max(0, Math.min(inSize - 1, j)) - first;
      weights[base + jj] += w;
      sum += w;
    }
    if (sum === 0) {
      // Degenerate (should not happen for valid kernels): fall back to nearest.
      weights[base + Math.max(0, Math.min(n - 1, Math.round(center) - first))] = 1;
      sum = 1;
    }
    for (let j = 0; j < n; j++) weights[base + j] /= sum;
    start[i] = first;
    count[i] = n;
  }
  return { start, count, weights, stride };
}

function nearest(src: Raster, w: number, h: number): Raster {
  const out = createRaster(w, h);
  const sx = src.width / w;
  const sy = src.height / h;
  const src32 = new Uint32Array(src.data.buffer, src.data.byteOffset, src.width * src.height);
  const out32 = new Uint32Array(out.data.buffer);
  for (let y = 0; y < h; y++) {
    const yy = Math.min(src.height - 1, Math.floor((y + 0.5) * sy));
    for (let x = 0; x < w; x++) {
      const xx = Math.min(src.width - 1, Math.floor((x + 0.5) * sx));
      out32[y * w + x] = src32[yy * src.width + xx];
    }
  }
  return out;
}

/** Resample with an arbitrary kernel. */
export function resampleWithKernel(src: Raster, w: number, h: number, k: Kernel): Raster {
  const sw = src.width;
  const sh = src.height;
  const sd = src.data;
  // Horizontal pass: sh rows × w columns, premultiplied float.
  const hw = computeWeights(sw, w, k);
  const tmp = new Float32Array(w * sh * 4);
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 4;
    for (let x = 0; x < w; x++) {
      const s = hw.start[x];
      const n = hw.count[x];
      const base = x * hw.stride;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = 0; j < n; j++) {
        const wt = hw.weights[base + j];
        const p = row + (s + j) * 4;
        const al = sd[p + 3] * wt;
        r += sd[p] * al;
        g += sd[p + 1] * al;
        b += sd[p + 2] * al;
        a += al;
      }
      const o = (y * w + x) * 4;
      tmp[o] = r / 255;
      tmp[o + 1] = g / 255;
      tmp[o + 2] = b / 255;
      tmp[o + 3] = a;
    }
  }
  // Vertical pass into the output, un-premultiplying.
  const vw = computeWeights(sh, h, k);
  const out = createRaster(w, h);
  const od = out.data;
  for (let y = 0; y < h; y++) {
    const s = vw.start[y];
    const n = vw.count[y];
    const base = y * vw.stride;
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = 0; j < n; j++) {
        const wt = vw.weights[base + j];
        const p = ((s + j) * w + x) * 4;
        r += tmp[p] * wt;
        g += tmp[p + 1] * wt;
        b += tmp[p + 2] * wt;
        a += tmp[p + 3] * wt;
      }
      const o = (y * w + x) * 4;
      if (a <= 0.5 / 255) {
        od[o] = od[o + 1] = od[o + 2] = od[o + 3] = 0;
        continue;
      }
      const inv = 255 / a;
      od[o] = r * inv;
      od[o + 1] = g * inv;
      od[o + 2] = b * inv;
      od[o + 3] = a;
    }
  }
  return out;
}

/** Unsharp mask: out = src + amount × (src − blur(src, sigma)). Alpha untouched. */
export function unsharpMask(src: Raster, sigma: number, amount: number): Raster {
  const blurred = gaussianBlur(src, sigma);
  const out = createRaster(src.width, src.height);
  const s = src.data;
  const b = blurred.data;
  const o = out.data;
  for (let i = 0; i < s.length; i += 4) {
    o[i] = s[i] + amount * (s[i] - b[i]);
    o[i + 1] = s[i + 1] + amount * (s[i + 1] - b[i + 1]);
    o[i + 2] = s[i + 2] + amount * (s[i + 2] - b[i + 2]);
    o[i + 3] = s[i + 3];
  }
  return out;
}

/** Resize an image to w×h with the given interpolation method. */
export function resample(src: Raster, w: number, h: number, method: ResampleMethod): Raster {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  if (method === 'nearest') return nearest(src, W, H);
  const out = resampleWithKernel(src, W, H, kernelFor(method)!);
  if (method === 'bicubic-sharp') {
    const p = METHOD_PARAMS.bicubicSharp;
    return unsharpMask(out, p.unsharpSigma, p.unsharpAmount);
  }
  return out;
}

export const METHOD_LABELS: Record<ResampleMethod, { label: string; use: string }> = {
  nearest: { label: '最近傍法（Nearest Neighbor）', use: 'ドット絵・ピクセルアート向け' },
  bilinear: { label: 'バイリニア法（Bilinear）', use: '軽量な一般用途' },
  bicubic: { label: 'バイキュービック法（Bicubic）', use: '写真の一般的な拡大・縮小' },
  lanczos: { label: 'Lanczos法（Lanczos3）', use: '写真の高品質な縮小' },
  'bicubic-sharp': { label: 'バイキュービック・シャープ', use: '縮小時の輪郭強調（a=−0.75＋アンシャープマスク）' },
  'bicubic-smooth': { label: 'バイキュービック・スムーズ', use: '拡大時の滑らかさ重視（Mitchell B=C=1/3）' },
};
