// SVG paint servers for pattern fills (types.ts Pattern). Each motif is drawn as vectors in
// one repeat (tile) of `size` px; the tile is centered on the object's box and turned by
// `angle`. Coordinates are the object's local frame (0..w, 0..h), as DocumentSvg draws it,
// so the pattern moves and turns with the object and keeps its size when the box changes.
import type { ReactElement } from 'react';
import type { Pattern, PatternMotif } from '../model/types';

interface Tile {
  w: number;
  h: number;
  /** The motif in `fg` over `bg` (bg may be null: nothing behind). */
  draw: (fg: string, bg: string | null) => ReactElement;
  /**
   * The motif hides parts of itself by painting the background over them (青海波). Without
   * a background color it is drawn through a mask instead.
   */
  occluding?: boolean;
}

const f = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pts = (ps: [number, number][]) => ps.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');

/** Path data of line segments. */
const segs = (ss: [number, number, number, number][]) => ss.map(([a, b, c, d]) => `M${f(a)} ${f(b)}L${f(c)} ${f(d)}`).join('');

function bgRect(w: number, h: number, bg: string | null) {
  return bg ? <rect width={w} height={h} fill={bg} /> : null;
}

/** Equilateral triangle lattice (side a, rows h apart) over a w×h tile, as triangles. */
function triangles(a: number, rowH: number, w: number, h: number): [number, number][][] {
  const out: [number, number][][] = [];
  for (let j = -1; j * rowH <= h; j++) {
    const off = Math.abs(j) % 2 ? a / 2 : 0;
    for (let x = off - 2 * a; x <= w + a; x += a) {
      const y0 = j * rowH;
      const y1 = y0 + rowH;
      out.push([[x, y0], [x + a, y0], [x + a / 2, y1]]);
      out.push([[x + a / 2, y1], [x + a * 1.5, y1], [x + a, y0]]);
    }
  }
  return out;
}

function tileOf(motif: PatternMotif, s: number, weight: number): Tile {
  const t = clamp(weight, 0.02, 0.98);
  switch (motif) {
    case 'stripes':
      return {
        w: s,
        h: s,
        draw: (fg, bg) => (
          <>
            {bgRect(s, s, bg)}
            <rect width={f(s * t)} height={s} fill={fg} />
          </>
        ),
      };
    case 'dots': {
      // Staggered dots; at full thickness neighbors touch.
      const r = f(t * s * (Math.SQRT2 / 4));
      const c: [number, number][] = [[0, 0], [s, 0], [0, s], [s, s], [s / 2, s / 2]];
      return {
        w: s,
        h: s,
        draw: (fg, bg) => (
          <>
            {bgRect(s, s, bg)}
            {c.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={r} fill={fg} />
            ))}
          </>
        ),
      };
    }
    case 'grid': {
      const lw = f(s * t * 0.5);
      return {
        w: s,
        h: s,
        draw: (fg, bg) => (
          <>
            {bgRect(s, s, bg)}
            <rect width={s} height={lw} fill={fg} />
            <rect width={lw} height={s} fill={fg} />
          </>
        ),
      };
    }
    case 'ichimatsu': {
      const c = s / 2;
      return {
        w: s,
        h: s,
        draw: (fg, bg) => (
          <>
            {bgRect(s, s, bg)}
            <rect width={c} height={c} fill={fg} />
            <rect x={c} y={c} width={c} height={c} fill={fg} />
          </>
        ),
      };
    }
    case 'uroko': {
      // Rows of upward triangles, each row offset by half a triangle (a triangular tiling
      // with every other triangle filled).
      const rh = (s * Math.sqrt(3)) / 2;
      const H = rh * 2;
      return {
        w: s,
        h: H,
        draw: (fg, bg) => (
          <>
            {bgRect(s, H, bg)}
            <polygon points={pts([[0, H], [s / 2, rh], [s, H]])} fill={fg} />
            <polygon points={pts([[-s / 2, rh], [0, 0], [s / 2, rh]])} fill={fg} />
            <polygon points={pts([[s / 2, rh], [s, 0], [s * 1.5, rh]])} fill={fg} />
          </>
        ),
      };
    }
    case 'yagasuri': {
      // Arrow feathers: columns of notched bands, the second column shifted by half a band.
      const c = s / 2;
      const L = s / 2;
      const d = c * 0.6;
      const band = (x: number, y: number): [number, number][] => [
        [x, y],
        [x + c / 2, y + d],
        [x + c, y],
        [x + c, y + L],
        [x + c / 2, y + L + d],
        [x, y + L],
      ];
      return {
        w: s,
        h: s,
        draw: (fg, bg) => (
          <>
            {bgRect(s, s, bg)}
            <polygon points={pts(band(0, 0))} fill={fg} />
            <polygon points={pts(band(c, L))} fill={fg} />
            <polygon points={pts(band(c, L - s))} fill={fg} />
          </>
        ),
      };
    }
    case 'seigaiha': {
      // Overlapping fans of concentric rings; each row of fans is drawn over the one above.
      const R = s / 2;
      const H = R;
      const gap = R / 4;
      const lw = f(clamp(gap * t * 2, 0.3, gap * 0.95));
      const centers: [number, number][] = [
        [R, -R / 2],
        [0, 0],
        [2 * R, 0],
        [R, R / 2],
        [0, R],
        [2 * R, R],
        [R, R * 1.5],
      ];
      return {
        w: s,
        h: H,
        occluding: true,
        draw: (fg, bg) => (
          <>
            {bgRect(s, H, bg)}
            {centers.map(([x, y], i) => (
              <g key={i}>
                <circle cx={x} cy={y} r={R} fill={bg ?? 'none'} />
                {[0, 1, 2, 3].map((k) => (
                  <circle key={k} cx={x} cy={y} r={f(R - lw / 2 - k * gap)} fill="none" stroke={fg} strokeWidth={lw} />
                ))}
              </g>
            ))}
          </>
        ),
      };
    }
    case 'shippo': {
      // Circles through each other's quarter points: rings of lens-shaped petals.
      const r = s / 2;
      const lw = f(clamp(s * t * 0.12, 0.3, s * 0.2));
      const c: [number, number][] = [[0, 0], [s, 0], [0, s], [s, s], [r, r]];
      return {
        w: s,
        h: s,
        draw: (fg, bg) => (
          <>
            {bgRect(s, s, bg)}
            {c.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={r} fill="none" stroke={fg} strokeWidth={lw} />
            ))}
          </>
        ),
      };
    }
    case 'kikko': {
      // Tortoise shell: flat-topped hexagons with an inner outline.
      const a = s / 3;
      const H = Math.sqrt(3) * a;
      const lw = f(clamp(a * t * 0.35, 0.3, a * 0.3));
      const hex = (cx: number, cy: number, k: number) =>
        pts([0, 60, 120, 180, 240, 300].map((deg) => [cx + Math.cos((deg * Math.PI) / 180) * a * k, cy + Math.sin((deg * Math.PI) / 180) * a * k]));
      const c: [number, number][] = [[0, 0], [3 * a, 0], [0, H], [3 * a, H], [1.5 * a, H / 2]];
      return {
        w: s,
        h: H,
        draw: (fg, bg) => (
          <>
            {bgRect(s, H, bg)}
            {c.map(([x, y], i) => (
              <g key={i} fill="none" stroke={fg} strokeWidth={lw} strokeLinejoin="round">
                <polygon points={hex(x, y, 1)} />
                <polygon points={hex(x, y, 0.72)} />
              </g>
            ))}
          </>
        ),
      };
    }
    case 'asanoha': {
      // Hemp leaf: a triangle lattice with lines from each triangle's center to its corners.
      const a = s;
      const rh = (a * Math.sqrt(3)) / 2;
      const H = rh * 2;
      const lw = f(clamp(a * t * 0.12, 0.3, a * 0.12));
      const lines: [number, number, number, number][] = [];
      for (const tri of triangles(a, rh, s, H)) {
        const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
        const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
        for (let i = 0; i < 3; i++) {
          const [p, q] = [tri[i], tri[(i + 1) % 3]];
          lines.push([p[0], p[1], q[0], q[1]], [cx, cy, p[0], p[1]]);
        }
      }
      return {
        w: s,
        h: H,
        draw: (fg, bg) => (
          <>
            {bgRect(s, H, bg)}
            <path d={segs(lines)} fill="none" stroke={fg} strokeWidth={lw} strokeLinecap="round" />
          </>
        ),
      };
    }
  }
}

/** Width and height of one repeat of the pattern in px. */
export function patternTileSize(p: Pattern): { width: number; height: number } {
  const t = tileOf(p.motif, p.size, p.weight);
  return { width: t.w, height: t.h };
}

/** The <pattern> for a pattern fill over a w×h box (centered on it). */
export function patternDef(p: Pattern, id: string, w: number, h: number): ReactElement {
  const tile = tileOf(p.motif, Math.max(1, p.size), p.weight);
  const tf = `translate(${f(w / 2)} ${f(h / 2)})` + (p.angle ? ` rotate(${f(p.angle)})` : '');
  const common = {
    id,
    patternUnits: 'userSpaceOnUse' as const,
    x: f(-tile.w / 2),
    y: f(-tile.h / 2),
    width: f(tile.w),
    height: f(tile.h),
    patternTransform: tf,
  };
  if (tile.occluding && !p.background) {
    // Transparent background: the motif (white) over black is the mask for the motif color.
    const mid = `${id}-m`;
    return (
      <pattern {...common}>
        <mask id={mid} maskUnits="userSpaceOnUse" x={0} y={0} width={tile.w} height={tile.h}>
          <rect width={tile.w} height={tile.h} fill="#000" />
          {tile.draw('#fff', '#000')}
        </mask>
        <rect width={tile.w} height={tile.h} fill={p.color} mask={`url(#${mid})`} />
      </pattern>
    );
  }
  return <pattern {...common}>{tile.draw(p.color, p.background)}</pattern>;
}
