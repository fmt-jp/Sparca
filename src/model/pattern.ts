// Pattern fills: the built-in motifs and defaults (see types.ts Pattern, render/pattern.tsx).
import type { Fill, Pattern, PatternMotif } from './types';

export interface MotifInfo {
  motif: PatternMotif;
  label: string;
  /** Whether the thickness setting changes this motif. */
  usesWeight: boolean;
  /** Initial thickness when the motif is chosen. */
  weight: number;
}

export const PATTERN_MOTIFS: MotifInfo[] = [
  { motif: 'stripes', label: '縞', usesWeight: true, weight: 0.5 },
  { motif: 'dots', label: '水玉', usesWeight: true, weight: 0.5 },
  { motif: 'grid', label: '格子', usesWeight: true, weight: 0.15 },
  { motif: 'ichimatsu', label: '市松', usesWeight: false, weight: 0.5 },
  { motif: 'uroko', label: '鱗', usesWeight: false, weight: 0.5 },
  { motif: 'yagasuri', label: '矢絣', usesWeight: false, weight: 0.5 },
  { motif: 'seigaiha', label: '青海波', usesWeight: true, weight: 0.3 },
  { motif: 'shippo', label: '七宝', usesWeight: true, weight: 0.3 },
  { motif: 'kikko', label: '亀甲', usesWeight: true, weight: 0.3 },
  { motif: 'asanoha', label: '麻の葉', usesWeight: true, weight: 0.3 },
];

export const PATTERN_SIZE = { min: 4, max: 500 };

export function motifInfo(m: PatternMotif): MotifInfo {
  return PATTERN_MOTIFS.find((x) => x.motif === m) ?? PATTERN_MOTIFS[0];
}

export function isPattern(f: Fill | null | undefined): f is Pattern {
  return typeof f === 'object' && f !== null && f.kind === 'pattern';
}

/**
 * A pattern derived from the current fill: an existing pattern is kept; otherwise the
 * motif takes the fill's (first) color on white.
 */
export function toPattern(current: Fill | null, color: string | null): Pattern {
  if (isPattern(current)) return current;
  return { kind: 'pattern', motif: 'stripes', color: color ?? '#000000', background: '#ffffff', size: 20, angle: 0, weight: motifInfo('stripes').weight };
}

/** The pattern with another motif (its usual thickness when the thickness matters). */
export function withMotif(p: Pattern, motif: PatternMotif): Pattern {
  return { ...p, motif, weight: motifInfo(motif).weight };
}
