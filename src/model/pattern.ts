// Pattern fills: the built-in motifs and defaults (see types.ts Pattern, render/pattern.tsx).
import type { Fill, Pattern, PatternMotif } from './types';

export interface MotifInfo {
  motif: PatternMotif;
  label: string;
  /** Whether the thickness setting changes this motif. */
  usesWeight: boolean;
  /** Initial thickness when the motif is chosen. */
  weight: number;
  /** Size (px) and angle the motif starts with when chosen, if it needs its own. */
  size?: number;
  angle?: number;
  /** Repeat size of its thumbnail in the motif buttons (default 12). */
  thumb?: number;
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
  { motif: 'sayagata', label: '紗綾形', usesWeight: true, weight: 0.4, size: 140, angle: 45, thumb: 40 },
  { motif: 'kagome', label: '籠目', usesWeight: true, weight: 0.3, size: 30, thumb: 14 },
  { motif: 'hishi', label: '菱', usesWeight: true, weight: 0.5, size: 40, thumb: 16 },
  { motif: 'tatewaku', label: '立涌', usesWeight: true, weight: 0.3, size: 36, thumb: 14 },
  { motif: 'raimon', label: '雷文', usesWeight: true, weight: 0.4, size: 32, thumb: 14 },
  { motif: 'kanoko', label: '鹿の子', usesWeight: true, weight: 0.6, size: 20, thumb: 10 },
  { motif: 'ajiro', label: '網代', usesWeight: true, weight: 0.6, size: 36, thumb: 14 },
  { motif: 'higaki', label: '檜垣', usesWeight: true, weight: 0.3, size: 60, angle: 45, thumb: 20 },
  { motif: 'chidori', label: '千鳥格子', usesWeight: false, weight: 0.5, size: 32, thumb: 12 },
  { motif: 'splatter', label: '油（しぶき）', usesWeight: true, weight: 0.5, size: 160, thumb: 40 },
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
  const m = motifInfo(motif);
  return { ...p, motif, weight: m.weight, ...(m.size !== undefined ? { size: m.size } : {}), ...(m.angle !== undefined ? { angle: m.angle } : {}) };
}
