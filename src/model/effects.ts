// Live effects: catalog, defaults and migration of the older fixed glow/shadow pair.
import { defaultCurves } from './curves';
import { newId } from './factory';
import type { Effect, EffectKind } from './types';

export const EFFECT_GROUPS: { label: string; kinds: { kind: EffectKind; label: string }[] }[] = [
  {
    label: 'シャドウとグロー',
    kinds: [
      { kind: 'drop-shadow', label: 'ドロップシャドウ' },
      { kind: 'inner-shadow', label: '内側シャドウ' },
      { kind: 'glow', label: 'グロー' },
      { kind: 'inner-glow', label: '内側グロー' },
    ],
  },
  {
    label: 'ベベルとエンボス',
    kinds: [
      { kind: 'bevel-inner', label: '内側ベベル' },
      { kind: 'bevel-outer', label: '外側ベベル' },
      { kind: 'emboss', label: 'エンボス' },
    ],
  },
  {
    label: 'ぼかしとシャープ',
    kinds: [
      { kind: 'blur', label: 'ぼかし' },
      { kind: 'sharpen', label: 'シャープ' },
    ],
  },
  {
    label: '色の調整',
    kinds: [
      { kind: 'brightness-contrast', label: '明るさ・コントラスト' },
      { kind: 'hue-saturation', label: '色相・彩度' },
      { kind: 'curves', label: 'トーンカーブ' },
      { kind: 'invert', label: '反転' },
      { kind: 'color-overlay', label: 'カラーオーバーレイ' },
    ],
  },
];

const LABELS = new Map(EFFECT_GROUPS.flatMap((g) => g.kinds.map((k) => [k.kind, k.label] as const)));

export const EFFECT_KINDS = new Set<string>(LABELS.keys());

export function effectLabel(kind: EffectKind): string {
  return LABELS.get(kind) ?? kind;
}

/** A new, enabled effect of `kind` with its default settings. */
export function createEffect(kind: EffectKind): Effect {
  const base = { id: newId('fx'), enabled: true, strength: 1 };
  // Fireworks defaults: width 10, contrast 75%, softness 3, light from the top-left.
  const bevel = { width: 10, softness: 3, angle: -135, intensity: 0.75 };
  switch (kind) {
    case 'drop-shadow':
      return { ...base, kind, color: '#000000', opacity: 0.5, angle: 45, distance: 6, blur: 4 };
    case 'inner-shadow':
      return { ...base, kind, color: '#000000', opacity: 0.6, angle: 45, distance: 4, blur: 4 };
    case 'glow':
      return { ...base, kind, color: '#ffd84a', opacity: 0.9, blur: 6, spread: 2 };
    case 'inner-glow':
      return { ...base, kind, color: '#ffffff', opacity: 0.8, blur: 6, spread: 2 };
    case 'bevel-inner':
      return { ...base, kind, ...bevel };
    case 'bevel-outer':
      return { ...base, kind, ...bevel, color: '#c0c0c0' };
    case 'emboss':
      return { ...base, kind, ...bevel, width: 5, showObject: true, inset: false };
    case 'blur':
      return { ...base, kind, radius: 4 };
    case 'sharpen':
      return { ...base, kind, amount: 1, radius: 2 };
    case 'brightness-contrast':
      return { ...base, kind, brightness: 0, contrast: 0 };
    case 'hue-saturation':
      return { ...base, kind, hue: 0, saturation: 0, lightness: 0 };
    case 'curves':
      return { ...base, kind, curves: defaultCurves() };
    case 'invert':
      return { ...base, kind };
    case 'color-overlay':
      return { ...base, kind, color: '#ff0000' };
  }
}

type LegacyEffects = {
  glow?: { enabled?: boolean } & Record<string, unknown>;
  dropShadow?: { enabled?: boolean } & Record<string, unknown>;
};

/**
 * Files written before effects became a list stored `{ glow, dropShadow }`. Enabled ones
 * become list entries: glow first, then the shadow (closest to the old look, where both
 * were drawn from the original shape behind it).
 */
export function migrateLegacyEffects(old: LegacyEffects): Effect[] {
  const out: Effect[] = [];
  if (old.glow?.enabled) out.push({ ...createEffect('glow'), ...pick(old.glow, ['color', 'opacity', 'blur', 'spread']) } as Effect);
  if (old.dropShadow?.enabled) {
    out.push({ ...createEffect('drop-shadow'), ...pick(old.dropShadow, ['color', 'opacity', 'angle', 'distance', 'blur']) } as Effect);
  }
  return out;
}

function pick(o: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
}
