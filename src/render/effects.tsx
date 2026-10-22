// Live effects → one SVG filter per object. Effects run in list order, each taking the
// previous result as input; strength < 1 blends the result with that input
// (docs/design.md §3). The filter works in the object's rotated local frame, so
// directions (shadow offset, light) are counter-rotated to stay fixed on screen.
import type { ReactElement } from 'react';
import { channelTable, isIdentityCurve } from '../model/curves';
import type { Effect } from '../model/types';

const ALPHA_ONLY = '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0';

export function activeEffects(effects: Effect[]): Effect[] {
  return effects.filter((e) => e.enabled && e.strength > 0);
}

/** How far the effects can reach outside the object (px), for the filter region. */
export function effectsMargin(effects: Effect[]): number {
  let m = 0;
  for (const e of activeEffects(effects)) {
    switch (e.kind) {
      case 'drop-shadow':
        m += e.distance + e.blur * 3;
        break;
      case 'glow':
        m += e.spread + e.blur * 3;
        break;
      case 'bevel-outer':
        m += e.width + e.softness * 3;
        break;
      case 'blur':
        m += e.radius * 3;
        break;
      case 'sharpen':
        m += e.radius;
        break;
    }
  }
  return m;
}

type Prim = ReactElement;

/** Builds the primitive chain; names are unique per filter. */
class Chain {
  prims: Prim[] = [];
  private n = 0;
  constructor(private readonly tag: string) {}
  name(hint: string): string {
    this.n += 1;
    return `${this.tag}${this.n}${hint}`;
  }
  add(el: (result: string) => Prim, hint = ''): string {
    const r = this.name(hint);
    this.prims.push(el(r));
    return r;
  }
  alpha(input: string): string {
    return this.add((r) => <feColorMatrix key={r} in={input} type="matrix" values={ALPHA_ONLY} result={r} />, 'a');
  }
  /** Alpha 1 − a (the outside of the shape). */
  inverse(alphaIn: string): string {
    return this.add(
      (r) => (
        <feComponentTransfer key={r} in={alphaIn} result={r}>
          <feFuncA type="table" tableValues="1 0" />
        </feComponentTransfer>
      ),
      'inv',
    );
  }
  blurSigma(input: string, sigma: number): string {
    if (sigma <= 0) return input;
    return this.add((r) => <feGaussianBlur key={r} in={input} stdDeviation={sigma} result={r} />, 'b');
  }
  blur(input: string, px: number): string {
    if (px <= 0) return input;
    return this.add((r) => <feGaussianBlur key={r} in={input} stdDeviation={px / 2} result={r} />, 'b');
  }
  offset(input: string, dx: number, dy: number): string {
    if (dx === 0 && dy === 0) return input;
    return this.add((r) => <feOffset key={r} in={input} dx={dx} dy={dy} result={r} />, 'o');
  }
  dilate(input: string, px: number): string {
    if (px <= 0) return input;
    return this.add((r) => <feMorphology key={r} in={input} operator="dilate" radius={px} result={r} />, 'd');
  }
  composite(a: string, b: string, operator: 'in' | 'out' | 'over'): string {
    return this.add((r) => <feComposite key={r} in={a} in2={b} operator={operator} result={r} />, 'c');
  }
  /** Solid color masked by `mask`'s alpha. */
  paint(mask: string, color: string, opacity: number): string {
    const f = this.add((r) => <feFlood key={r} floodColor={color} floodOpacity={opacity} result={r} />, 'f');
    return this.composite(f, mask, 'in');
  }
  merge(inputs: string[]): string {
    return this.add(
      (r) => (
        <feMerge key={r} result={r}>
          {inputs.map((i) => (
            <feMergeNode key={i} in={i} />
          ))}
        </feMerge>
      ),
      'm',
    );
  }
  /** a·k2 + b·k3 (premultiplied), e.g. a blend between two results. */
  arithmetic(a: string, b: string, k2: number, k3: number): string {
    return this.add((r) => <feComposite key={r} in={a} in2={b} operator="arithmetic" k1={0} k2={k2} k3={k3} k4={0} result={r} />, 'x');
  }
}

function dir(deg: number, rotation: number): { x: number; y: number } {
  const a = ((deg - rotation) * Math.PI) / 180;
  return { x: Math.cos(a), y: Math.sin(a) };
}

/** Height of the light above the surface; a flat surface gets sin(ELEVATION) of it. */
const ELEVATION = 50;
const FLAT = Math.sin((ELEVATION * Math.PI) / 180);

/**
 * Bevel shading (Fireworks-style "smooth" profile): `height` is a blurred alpha used as a
 * height map and lit by a distant light from `angle` (direction the light comes from).
 * Slopes facing the light become lighter, slopes facing away darker, flat areas stay
 * unchanged. Returns highlight and shade layers clipped to `clip`.
 */
function lighting(c: Chain, height: string, sigma: number, angle: number, rotation: number, intensity: number, clip: string): [string, string] {
  // The lighting's Sobel normal has slope 2·surfaceScale·dh/dx, and a Gaussian edge's
  // steepest dh/dx is 0.4/σ: this tilts the steepest part about 40° (steeper turns the
  // shade black). kernelUnitLength keeps the slope in document px at any zoom.
  const surfaceScale = 1.05 * Math.max(0.5, sigma);
  const lit = c.add(
    (r) => (
      <feDiffuseLighting key={r} in={height} surfaceScale={surfaceScale} diffuseConstant={1} kernelUnitLength={1} lightingColor="#ffffff" result={r}>
        <feDistantLight azimuth={angle - rotation} elevation={ELEVATION} />
      </feDiffuseLighting>
    ),
    'lit',
  );
  // Brightness above / below a flat surface's → white / black alpha.
  const gHi = intensity / (1 - FLAT);
  const gSh = intensity / FLAT;
  const hi = c.add(
    (r) => <feColorMatrix key={r} in={lit} type="matrix" values={`0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${gHi} 0 0 0 ${-gHi * FLAT}`} result={r} />,
    'hi',
  );
  const sh = c.add(
    (r) => <feColorMatrix key={r} in={lit} type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${-gSh} 0 0 0 ${gSh * FLAT}`} result={r} />,
    'sh',
  );
  return [c.composite(hi, clip, 'in'), c.composite(sh, clip, 'in')];
}

/** The shape grown by about `px` with rounded corners (blurred alpha, thresholded). */
function grow(c: Chain, alpha: string, px: number): string {
  if (px <= 0) return alpha;
  // A Gaussian edge reaches 5% at 1.645σ.
  const b = c.blurSigma(alpha, px / 1.645);
  return c.add(
    (r) => (
      <feComponentTransfer key={r} in={b} result={r}>
        <feFuncA type="linear" slope={20} intercept={-1} />
      </feComponentTransfer>
    ),
    'g',
  );
}

function linear(slope: number, intercept: number) {
  return (
    <>
      <feFuncR type="linear" slope={slope} intercept={intercept} />
      <feFuncG type="linear" slope={slope} intercept={intercept} />
      <feFuncB type="linear" slope={slope} intercept={intercept} />
    </>
  );
}

/** Same contrast curve as the image color adjustment (engine/color.ts). */
function contrastFactor(c: number): number {
  const C = (c / 100) * 255 * 0.99;
  return (259 * (C + 255)) / (255 * (259 - C));
}

function applyEffect(c: Chain, e: Effect, input: string, rotation: number): string {
  switch (e.kind) {
    case 'drop-shadow': {
      const d = dir(e.angle, rotation);
      const sh = c.offset(c.blur(c.alpha(input), e.blur), d.x * e.distance, d.y * e.distance);
      return c.merge([c.paint(sh, e.color, e.opacity), input]);
    }
    case 'inner-shadow': {
      const d = dir(e.angle, rotation);
      const outside = c.inverse(c.alpha(input));
      const sh = c.blur(c.offset(outside, d.x * e.distance, d.y * e.distance), e.blur);
      const inner = c.composite(c.paint(sh, e.color, e.opacity), input, 'in');
      return c.merge([input, inner]);
    }
    case 'glow': {
      const g = c.blur(c.dilate(c.alpha(input), e.spread), e.blur);
      return c.merge([c.paint(g, e.color, e.opacity), input]);
    }
    case 'inner-glow': {
      const g = c.blur(c.dilate(c.inverse(c.alpha(input)), e.spread), e.blur);
      const inner = c.composite(c.paint(g, e.color, e.opacity), input, 'in');
      return c.merge([input, inner]);
    }
    case 'bevel-inner': {
      // A band `width` wide inside the edge, sloping up toward the inside: the height
      // map is the shape shrunk by half the width, blurred across the band.
      const a = c.alpha(input);
      const sigma = e.width / 4 + e.softness / 2;
      const mid = c.inverse(grow(c, c.inverse(a), e.width / 2));
      const [hi, sh] = lighting(c, c.blurSigma(mid, sigma), sigma, e.angle, rotation, e.intensity, a);
      return c.merge([input, hi, sh]);
    }
    case 'bevel-outer': {
      // A rim of `color` `width` wide around the shape (rounded corners), sloping down
      // away from the shape across its whole width.
      const a = c.alpha(input);
      const rim = grow(c, a, e.width);
      const sigma = e.width / 4 + e.softness / 2;
      const [hi, sh] = lighting(c, c.blurSigma(grow(c, a, e.width / 2), sigma), sigma, e.angle, rotation, e.intensity, rim);
      return c.merge([c.paint(rim, e.color, 1), hi, sh, input]);
    }
    case 'emboss': {
      // Relief centered on the edge, shown inside the shape.
      const a = c.alpha(input);
      const base = e.showObject ? input : c.paint(a, '#808080', 1);
      const sigma = e.width / 2 + e.softness / 2;
      const [hi, sh] = lighting(c, c.blurSigma(a, sigma), sigma, e.inset ? e.angle + 180 : e.angle, rotation, e.intensity, a);
      return c.merge([base, hi, sh]);
    }
    case 'blur':
      return e.radius > 0 ? c.blur(input, e.radius) : input;
    case 'sharpen': {
      if (e.amount <= 0 || e.radius <= 0) return input;
      const b = c.blur(input, e.radius);
      return c.arithmetic(input, b, 1 + e.amount, -e.amount);
    }
    case 'brightness-contrast': {
      const k = contrastFactor(e.contrast);
      const bright = ((e.brightness / 100) * 128) / 255;
      return c.add(
        (r) => (
          <feComponentTransfer key={r} in={input} result={r}>
            {linear(k, k * (bright - 0.5) + 0.5)}
          </feComponentTransfer>
        ),
        'bc',
      );
    }
    case 'hue-saturation': {
      let out = input;
      if (e.hue) out = c.add((r) => <feColorMatrix key={r} in={out} type="hueRotate" values={String(e.hue)} result={r} />, 'h');
      if (e.saturation) {
        const s = out;
        out = c.add((r) => <feColorMatrix key={r} in={s} type="saturate" values={String(1 + e.saturation / 100)} result={r} />, 's');
      }
      if (e.lightness) {
        const l = e.lightness / 100;
        const s = out;
        out = c.add(
          (r) => (
            <feComponentTransfer key={r} in={s} result={r}>
              {l > 0 ? linear(1 - l, l) : linear(1 + l, 0)}
            </feComponentTransfer>
          ),
          'l',
        );
      }
      return out;
    }
    case 'curves': {
      const cv = e.curves;
      if ((['rgb', 'r', 'g', 'b'] as const).every((ch) => isIdentityCurve(cv[ch]))) return input;
      const table = (ch: 'r' | 'g' | 'b') => channelTable(cv, ch).map((v) => +v.toFixed(4)).join(' ');
      return c.add(
        (r) => (
          <feComponentTransfer key={r} in={input} result={r}>
            <feFuncR type="table" tableValues={table('r')} />
            <feFuncG type="table" tableValues={table('g')} />
            <feFuncB type="table" tableValues={table('b')} />
          </feComponentTransfer>
        ),
        'cv',
      );
    }
    case 'invert':
      return c.add(
        (r) => (
          <feComponentTransfer key={r} in={input} result={r}>
            <feFuncR type="table" tableValues="1 0" />
            <feFuncG type="table" tableValues="1 0" />
            <feFuncB type="table" tableValues="1 0" />
          </feComponentTransfer>
        ),
        'i',
      );
    case 'color-overlay':
      return c.paint(input, e.color, 1);
  }
}

/** The object's effects filter, or null when no effect is active. */
export function effectsFilter(id: string, effects: Effect[], w: number, h: number, rotation: number, strokeWidth: number): ReactElement | null {
  const list = activeEffects(effects);
  if (!list.length) return null;
  const c = new Chain('e');
  let prev = 'SourceGraphic';
  for (const e of list) {
    const out = applyEffect(c, e, prev, rotation);
    prev = e.strength < 1 && out !== prev ? c.arithmetic(out, prev, e.strength, 1 - e.strength) : out;
  }
  // The filter's output is its last primitive; make sure that is the final result.
  if (prev === 'SourceGraphic') return null;
  if (c.prims.length && (c.prims[c.prims.length - 1].props as { result?: string }).result !== prev) c.merge([prev]);
  const margin = strokeWidth + effectsMargin(list) + 8;
  return (
    <defs>
      <filter
        id={id}
        filterUnits="userSpaceOnUse"
        x={-margin}
        y={-margin}
        width={w + margin * 2}
        height={h + margin * 2}
        colorInterpolationFilters="sRGB"
      >
        {c.prims}
      </filter>
    </defs>
  );
}
