// Color adjustments (spec §7.5, docs/design.md §4.2).
// All per-channel operations are folded into one 256-entry lookup table per channel;
// saturation, which mixes channels, runs as a second pass.
import type { AutoColorParams, ColorAdjust } from '../model/types';
import { createRaster, type Raster } from './raster';

/** Fraction of pixels clipped at each end of the histogram by auto color. */
export const AUTO_CLIP = 0.005;
/** Channels whose usable range is narrower than this are not stretched (avoids amplifying noise). */
export const AUTO_MIN_RANGE = 16;
/** Neutral midtones: pixels this close to gray (saturation (max−min)/max) and in this brightness range decide the balance. */
export const AUTO_NEUTRAL_SATURATION = 0.15;
export const AUTO_NEUTRAL_RANGE = [40, 215] as const;
/** At least this fraction of pixels must be near-neutral, or the balance is left alone. */
export const AUTO_NEUTRAL_MIN_FRACTION = 0.01;
export const AUTO_GAMMA_LIMITS = [0.67, 1.5] as const;

const TEMP_STRENGTH = 0.2;
const TINT_STRENGTH = 0.2;

export function isIdentityAdjust(a: ColorAdjust): boolean {
  return !a.auto && a.brightness === 0 && a.contrast === 0 && a.saturation === 0 && a.temperature === 0 && a.tint === 0;
}

function contrastFactor(c: number): number {
  const C = (c / 100) * 255 * 0.99; // keep the denominator positive at +100
  return (259 * (C + 255)) / (255 * (259 - C));
}

/** Build per-channel lookup tables for everything except saturation. */
export function buildLuts(a: ColorAdjust): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] {
  const k = contrastFactor(a.contrast);
  const bright = (a.brightness / 100) * 128;
  const t = a.temperature / 100;
  const tint = a.tint / 100;
  const channelGain = [1 + TEMP_STRENGTH * t, 1 - TINT_STRENGTH * tint, 1 - TEMP_STRENGTH * t];
  return [0, 1, 2].map((c) => {
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let x = v;
      if (a.auto) {
        const lo = a.auto.black[c];
        const hi = a.auto.white[c];
        x = hi > lo ? ((x - lo) / (hi - lo)) * 255 : x;
        if (a.auto.gamma && a.auto.gamma[c] !== 1) x = 255 * Math.pow(Math.min(1, Math.max(0, x / 255)), a.auto.gamma[c]);
        x *= a.auto.gains[c];
      }
      x += bright;
      x = k * (x - 128) + 128;
      x *= channelGain[c];
      lut[v] = Math.round(x);
    }
    return lut;
  }) as [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray];
}

export function applyAdjust(src: Raster, a: ColorAdjust): Raster {
  const out = createRaster(src.width, src.height);
  const [lr, lg, lb] = buildLuts(a);
  const s = src.data;
  const o = out.data;
  const sat = 1 + a.saturation / 100;
  for (let i = 0; i < s.length; i += 4) {
    let r = lr[s[i]];
    let g = lg[s[i + 1]];
    let b = lb[s[i + 2]];
    if (sat !== 1) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = l + (r - l) * sat;
      g = l + (g - l) * sat;
      b = l + (b - l) * sat;
    }
    o[i] = r;
    o[i + 1] = g;
    o[i + 2] = b;
    o[i + 3] = s[i + 3];
  }
  return out;
}

/**
 * Analyze an image for auto color (docs/design.md §4.2):
 * 1. Per-channel levels: black/white points at the AUTO_CLIP percentiles of each channel's histogram.
 * 2. Neutral midtones: after the stretch, the pixels that are already nearly gray (low
 *    saturation, mid brightness) should average to gray; a per-channel gamma moves their
 *    mean there. Unlike gray world, an image dominated by warm or cool colors is not
 *    pushed toward the opposite color. With too few near-gray pixels the balance stays.
 * Fully transparent pixels are ignored.
 */
export function computeAutoColor(src: Raster): AutoColorParams {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const d = src.data;
  let count = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    hist[0][d[i]]++;
    hist[1][d[i + 1]]++;
    hist[2][d[i + 2]]++;
    count++;
  }
  if (count === 0) return { black: [0, 0, 0], white: [255, 255, 255], gains: [1, 1, 1] };
  const clip = count * AUTO_CLIP;
  const black: [number, number, number] = [0, 0, 0];
  const white: [number, number, number] = [255, 255, 255];
  for (let c = 0; c < 3; c++) {
    let acc = 0;
    let lo = 0;
    while (lo < 255 && acc + hist[c][lo] <= clip) acc += hist[c][lo++];
    acc = 0;
    let hi = 255;
    while (hi > 0 && acc + hist[c][hi] <= clip) acc += hist[c][hi--];
    if (hi - lo >= AUTO_MIN_RANGE) {
      black[c] = lo;
      white[c] = hi;
    }
  }
  // Mean color of the near-neutral midtone pixels after the stretch.
  const stretch = (v: number, c: number) => Math.min(255, Math.max(0, ((v - black[c]) / (white[c] - black[c])) * 255));
  const sum = [0, 0, 0];
  let neutral = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = stretch(d[i], 0);
    const g = stretch(d[i + 1], 1);
    const b = stretch(d[i + 2], 2);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const lum = (r + g + b) / 3;
    if (lum <= AUTO_NEUTRAL_RANGE[0] || lum >= AUTO_NEUTRAL_RANGE[1] || (mx - mn) / mx >= AUTO_NEUTRAL_SATURATION) continue;
    sum[0] += r;
    sum[1] += g;
    sum[2] += b;
    neutral++;
  }
  let gamma: [number, number, number] = [1, 1, 1];
  if (neutral >= count * AUTO_NEUTRAL_MIN_FRACTION) {
    const m = sum.map((v) => v / neutral / 255);
    const target = (m[0] + m[1] + m[2]) / 3;
    const [lo, hi] = AUTO_GAMMA_LIMITS;
    gamma = m.map((v) => {
      if (v <= 0 || v >= 1) return 1;
      return Math.round(Math.min(hi, Math.max(lo, Math.log(target) / Math.log(v))) * 1000) / 1000;
    }) as [number, number, number];
  }
  return { black, white, gains: [1, 1, 1], gamma };
}
