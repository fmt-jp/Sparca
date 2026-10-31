// SVG paint servers for gradient fills and strokes (and pattern fills, render/pattern).
// Linear and radial map to SVG gradients; SVG has no conic gradient, so a conic one is drawn
// into an image (canvas) and used as a pattern. Coordinates are the object's local frame
// (0..w, 0..h), as DocumentSvg draws it.
import type { ReactElement } from 'react';
import { sortedStops, gradientAngle } from '../model/gradient';
import type { Fill, Gradient } from '../model/types';
import { patternDef } from './pattern';

/**
 * Paint for `fill` / `stroke` attributes, plus the definition to put next to the element.
 * `margin` is how far the painted area reaches outside the box (half a stroke width), so a
 * conic image covers it too.
 */
export function fillPaint(fill: Fill | null, id: string, w: number, h: number, margin = 0): { paint: string; def: ReactElement | null } {
  if (fill === null) return { paint: 'none', def: null };
  if (typeof fill === 'string') return { paint: fill, def: null };
  if (fill.kind === 'pattern') return { paint: `url(#${id})`, def: patternDef(fill, id, w, h) };
  const def = gradientDef(fill, id, w, h, margin);
  if (!def) return { paint: sortedStops(fill.stops)[0]?.color ?? 'none', def: null };
  return { paint: `url(#${id})`, def };
}

function stops(g: Gradient) {
  return sortedStops(g.stops).map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />);
}

function gradientDef(g: Gradient, id: string, w: number, h: number, margin: number): ReactElement | null {
  // Box-normalized coordinates, mapped onto the box by the transform.
  const tf = `matrix(${w} 0 0 ${h} 0 0)`;
  if (g.kind === 'linear') {
    return (
      <linearGradient id={id} gradientUnits="userSpaceOnUse" gradientTransform={tf} x1={g.start.x} y1={g.start.y} x2={g.end.x} y2={g.end.y}>
        {stops(g)}
      </linearGradient>
    );
  }
  if (g.kind === 'radial') {
    const r = Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y);
    return (
      <radialGradient id={id} gradientUnits="userSpaceOnUse" gradientTransform={tf} cx={g.start.x} cy={g.start.y} r={r} fx={g.start.x} fy={g.start.y}>
        {stops(g)}
      </radialGradient>
    );
  }
  const m = Math.max(0, margin);
  const href = conicImage(g, w, h, m);
  if (!href) return null;
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" x={-m} y={-m} width={w + 2 * m} height={h + 2 * m}>
      <image href={href} width={w + 2 * m} height={h + 2 * m} preserveAspectRatio="none" />
    </pattern>
  );
}

/** Longest side of the conic image; small objects get 2× for sharper zoomed views. */
const CONIC_MAX = 2048;
const conicCache = new Map<string, string | null>();

/**
 * PNG data URL of a conic gradient over a w×h box, widened by `m` on every side (null when
 * the browser cannot draw it).
 */
export function conicImage(g: Gradient, w: number, h: number, m = 0): string | null {
  if (w <= 0 || h <= 0) return null;
  const k = Math.min(2, CONIC_MAX / Math.max(w + 2 * m, h + 2 * m));
  const W = Math.max(1, Math.round((w + 2 * m) * k));
  const H = Math.max(1, Math.round((h + 2 * m) * k));
  const key = JSON.stringify([g.start, g.end, g.stops, w, h, m, W, H]);
  const hit = conicCache.get(key);
  if (hit !== undefined) return hit;
  let url: string | null = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (ctx && typeof ctx.createConicGradient === 'function') {
      const angle = (gradientAngle(g, w, h) * Math.PI) / 180;
      const cg = ctx.createConicGradient(angle, (g.start.x * w + m) * k, (g.start.y * h + m) * k);
      for (const s of sortedStops(g.stops)) {
        const n = parseInt(s.color.slice(1), 16);
        cg.addColorStop(Math.min(1, Math.max(0, s.offset)), `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${s.opacity})`);
      }
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, W, H);
      url = canvas.toDataURL('image/png');
    }
  }
  if (conicCache.size > 64) conicCache.delete(conicCache.keys().next().value!);
  conicCache.set(key, url);
  return url;
}
