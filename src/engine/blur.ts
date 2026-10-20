// Gaussian blur (docs/design.md §4.3). Small sigmas use an exact separable kernel;
// larger ones use three successive box blurs (O(n) per pixel regardless of radius).
// Color channels are blurred premultiplied by alpha.
import { createRaster, type Raster } from './raster';

const EXACT_SIGMA_LIMIT = 3;

/** Box widths whose three-pass convolution approximates a gaussian of the given sigma. */
export function boxesForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const first = src[row];
    let val = (r + 1) * first;
    for (let j = 0; j < r; j++) val += src[row + Math.min(j, w - 1)];
    for (let x = 0; x < w; x++) {
      val += src[row + Math.min(x + r, w - 1)] - (x - r - 1 >= 0 ? src[row + x - r - 1] : first);
      dst[row + x] = val * iarr;
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    const first = src[x];
    let val = (r + 1) * first;
    for (let j = 0; j < r; j++) val += src[Math.min(j, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      val += src[Math.min(y + r, h - 1) * w + x] - (y - r - 1 >= 0 ? src[(y - r - 1) * w + x] : first);
      dst[y * w + x] = val * iarr;
    }
  }
}

function gaussKernel(sigma: number): Float32Array {
  const r = Math.ceil(sigma * 3);
  const k = new Float32Array(r * 2 + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

function convolveH(src: Float32Array, dst: Float32Array, w: number, h: number, k: Float32Array) {
  const r = (k.length - 1) / 2;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) v += src[row + Math.min(w - 1, Math.max(0, x + i))] * k[i + r];
      dst[row + x] = v;
    }
  }
}

function convolveV(src: Float32Array, dst: Float32Array, w: number, h: number, k: Float32Array) {
  const r = (k.length - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) v += src[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r];
      dst[y * w + x] = v;
    }
  }
}

/** Blur one float channel in place (uses `tmp` as scratch space). */
export function blurChannel(ch: Float32Array, tmp: Float32Array, w: number, h: number, sigma: number): void {
  if (sigma <= 0) return;
  if (sigma < EXACT_SIGMA_LIMIT) {
    const k = gaussKernel(sigma);
    convolveH(ch, tmp, w, h, k);
    convolveV(tmp, ch, w, h, k);
    return;
  }
  for (const size of boxesForGauss(sigma)) {
    const r = (size - 1) / 2;
    boxBlurH(ch, tmp, w, h, r);
    boxBlurV(tmp, ch, w, h, r);
  }
}

/** Gaussian blur with standard deviation `sigma` px. Returns a new raster. */
export function gaussianBlur(src: Raster, sigma: number): Raster {
  const { width: w, height: h, data } = src;
  const out = createRaster(w, h);
  if (sigma <= 0) {
    out.data.set(data);
    return out;
  }
  const n = w * h;
  const alpha = new Float32Array(n);
  const ch = new Float32Array(n);
  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = data[i * 4 + 3];
  const blurredAlpha = new Float32Array(alpha);
  blurChannel(blurredAlpha, tmp, w, h, sigma);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) ch[i] = data[i * 4 + c] * alpha[i];
    blurChannel(ch, tmp, w, h, sigma);
    for (let i = 0; i < n; i++) {
      const a = blurredAlpha[i];
      out.data[i * 4 + c] = a > 1e-3 ? ch[i] / a : 0;
    }
  }
  for (let i = 0; i < n; i++) out.data[i * 4 + 3] = blurredAlpha[i];
  return out;
}

/** Blend `b` over `a` using a coverage mask (0..1 per pixel): out = a + (b − a) × m. */
export function blendWithMask(a: Raster, b: Raster, mask: Float32Array): Raster {
  const out = createRaster(a.width, a.height);
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    const m = mask[i];
    for (let c = 0; c < 4; c++) {
      const p = i * 4 + c;
      out.data[p] = m <= 0 ? a.data[p] : m >= 1 ? b.data[p] : a.data[p] + (b.data[p] - a.data[p]) * m;
    }
  }
  return out;
}
