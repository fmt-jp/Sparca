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

function tileOf(motif: PatternMotif, s: number, weight: number, seed = 1): Tile {
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
    case 'sayagata': {
      // 紗綾形: the manji of a 5×5 grid joined to its neighbors' (卍つなぎ), as lines;
      // shown turned 45° by default (the motif's starting angle).
      const c = s / 5;
      const lw = f(clamp(c * (0.25 + t * 0.6), 0.3, c * 0.9));
      const m = ['X.XXX', 'X.X..', 'XXXXX', '..X.X', 'XXX.X'];
      const on = (x: number, y: number) => m[((y % 5) + 5) % 5][((x % 5) + 5) % 5] === 'X';
      let d = '';
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          if (!on(x, y)) continue;
          const cx = f((x + 0.5) * c);
          const cy = f((y + 0.5) * c);
          if (on(x + 1, y)) d += `M${cx} ${cy}H${f(cx + c)}`;
          if (on(x, y + 1)) d += `M${cx} ${cy}V${f(cy + c)}`;
        }
      }
      return {
        w: s,
        h: s,
        draw: (fg, bg) => (
          <>
            {bgRect(s, s, bg)}
            {[[0, 0], [-s, 0], [0, -s], [-s, -s]].map(([dx, dy], i) => (
              <path key={i} d={d} transform={`translate(${f(dx)} ${f(dy)})`} fill="none" stroke={fg} strokeWidth={lw} strokeLinecap="square" />
            ))}
          </>
        ),
      };
    }
    case 'kagome': {
      // 籠目: three families of lines (the horizontal ones half a step off), hexagons and triangles.
      const a = s;
      const H = a * Math.sqrt(3);
      const lw = f(clamp(a * t * 0.35, 0.3, a * 0.3));
      const lines: [number, number, number, number][] = [
        [-a, H / 4, 2 * a, H / 4],
        [-a, (3 * H) / 4, 2 * a, (3 * H) / 4],
      ];
      for (let k = -2; k <= 2; k++) lines.push([k * a, 0, k * a + a, H], [k * a + a, 0, k * a, H]);
      return {
        w: a,
        h: H,
        draw: (fg, bg) => (
          <>
            {bgRect(a, H, bg)}
            <path d={segs(lines)} fill="none" stroke={fg} strokeWidth={lw} />
          </>
        ),
      };
    }
    case 'hishi': {
      // 菱: joined diamonds, each with a smaller solid diamond inside (its size: the thickness).
      const w = s;
      const H = s * 0.6;
      const lw = f(clamp(s * 0.05, 0.3, s * 0.1));
      const dia = (cx: number, cy: number, dw: number, dh: number) => pts([[cx, cy - dh / 2], [cx + dw / 2, cy], [cx, cy + dh / 2], [cx - dw / 2, cy]]);
      const k = 0.15 + t * 0.6;
      const centers: [number, number][] = [[w / 2, H / 2], [0, 0], [w, 0], [0, H], [w, H]];
      return {
        w,
        h: H,
        draw: (fg, bg) => (
          <>
            {bgRect(w, H, bg)}
            {centers.map(([x, y], i) => (
              <g key={i}>
                <polygon points={dia(x, y, w, H)} fill="none" stroke={fg} strokeWidth={lw} />
                <polygon points={dia(x, y, w * k, H * k)} fill={fg} />
              </g>
            ))}
          </>
        ),
      };
    }
    case 'tatewaku': {
      // 立涌: pairs of facing waves, widening and narrowing in turn.
      const w = s;
      const H = s * 1.33;
      const lw = f(clamp(s * t * 0.2, 0.3, s * 0.15));
      const amp = s * 0.19;
      const wave = (cx: number, sign: number) => {
        let d = '';
        for (let i = 0; i <= 32; i++) {
          const y = (i / 32) * H;
          d += `${i ? 'L' : 'M'}${f(cx + sign * amp * Math.cos((2 * Math.PI * y) / H))} ${f(y)}`;
        }
        return d;
      };
      return {
        w,
        h: H,
        draw: (fg, bg) => (
          <>
            {bgRect(w, H, bg)}
            <path d={wave(w * 0.25, 1) + wave(w * 0.75, -1)} fill="none" stroke={fg} strokeWidth={lw} />
          </>
        ),
      };
    }
    case 'raimon': {
      // 雷文: a square spiral on a base line, repeated.
      const u = s / 32;
      const lw = f(clamp(u * 7 * t, 0.3, u * 5));
      const d = `M0 ${f(28 * u)}H${f(32 * u)}M${f(4 * u)} ${f(28 * u)}V${f(4 * u)}H${f(28 * u)}V${f(22 * u)}H${f(10 * u)}V${f(10 * u)}H${f(22 * u)}V${f(16 * u)}H${f(16 * u)}`;
      return {
        w: s,
        h: s,
        draw: (fg, bg) => (
          <>
            {bgRect(s, s, bg)}
            <path d={d} fill="none" stroke={fg} strokeWidth={lw} strokeLinecap="square" />
          </>
        ),
      };
    }
    case 'kanoko': {
      // 鹿の子: rounded diamonds with a dot left open in the middle.
      const r = f((s / 2) * (0.35 + t * 0.55) * Math.SQRT1_2);
      const hole = f(s * 0.09);
      const centers: [number, number][] = [[0, 0], [s, 0], [0, s], [s, s], [s / 2, s / 2]];
      return {
        w: s,
        h: s,
        occluding: true,
        draw: (fg, bg) => (
          <>
            {bgRect(s, s, bg)}
            {centers.map(([x, y], i) => (
              <g key={i}>
                <rect x={f(x - r)} y={f(y - r)} width={f(r * 2)} height={f(r * 2)} rx={f(r * 0.3)} transform={`rotate(45 ${f(x)} ${f(y)})`} fill={fg} />
                <circle cx={f(x)} cy={f(y)} r={hole} fill={bg ?? 'none'} />
              </g>
            ))}
          </>
        ),
      };
    }
    case 'ajiro': {
      // 網代: blocks of three bands, horizontal and vertical in turn.
      const q = s / 2;
      const bandW = (q / 3) * (0.3 + t * 0.6);
      const band = (x: number, y: number, horizontal: boolean) =>
        [0, 1, 2].map((i) => {
          const o = (q / 3) * i + (q / 3 - bandW) / 2;
          return horizontal ? (
            <rect key={`${x}-${y}-${i}`} x={f(x + q * 0.04)} y={f(y + o)} width={f(q * 0.92)} height={f(bandW)} rx={f(bandW * 0.25)} />
          ) : (
            <rect key={`${x}-${y}-${i}`} x={f(x + o)} y={f(y + q * 0.04)} width={f(bandW)} height={f(q * 0.92)} rx={f(bandW * 0.25)} />
          );
        });
      return {
        w: s,
        h: s,
        draw: (fg, bg) => (
          <>
            {bgRect(s, s, bg)}
            <g fill={fg}>
              {band(0, 0, true)}
              {band(q, 0, false)}
              {band(0, q, false)}
              {band(q, q, true)}
            </g>
          </>
        ),
      };
    }
    case 'splatter': {
      // 油（しぶき）: blots and droplets scattered at random (`seed`); shapes crossing the
      // tile's edge are drawn again on the other side, so no seam shows. The thickness is
      // how much is splattered.
      let state = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
      const rnd = () => (state = (state * 16807) % 2147483647) / 2147483647;
      const shapes: ReactElement[] = [];
      let key = 0;
      const blobs = Math.round(2 + t * 8);
      for (let b = 0; b < blobs; b++) {
        const cx = rnd() * s;
        const cy = rnd() * s;
        const r = s * (0.03 + rnd() * 0.06);
        let d = '';
        for (let i = 0; i <= 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const rr = r * (0.75 + rnd() * 0.5);
          d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * rr)} ${f(cy + Math.sin(a) * rr)}`;
        }
        shapes.push(<path key={key++} d={`${d}Z`} strokeWidth={f(r * 0.35)} strokeLinejoin="round" />);
        for (let k = 0; k < 9; k++) {
          const a = rnd() * Math.PI * 2;
          const dist = r * (1.3 + rnd() * 2.4);
          const dr = r * (0.08 + rnd() * 0.2) * Math.max(0.3, 2.2 - dist / r / 2);
          shapes.push(<circle key={key++} cx={f(cx + Math.cos(a) * dist)} cy={f(cy + Math.sin(a) * dist)} r={f(dr)} strokeWidth={0} />);
        }
      }
      for (let i = 0, n = Math.round(10 + t * 40); i < n; i++) shapes.push(<circle key={key++} cx={f(rnd() * s)} cy={f(rnd() * s)} r={f(s * (0.003 + rnd() * 0.01))} strokeWidth={0} />);
      return {
        w: s,
        h: s,
        draw: (fg, bg) => (
          <>
            {bgRect(s, s, bg)}
            {[-s, 0, s].flatMap((dx) =>
              [-s, 0, s].map((dy) => (
                <g key={`${dx},${dy}`} transform={`translate(${f(dx)} ${f(dy)})`} fill={fg} stroke={fg}>
                  {shapes}
                </g>
              )),
            )}
          </>
        ),
      };
    }
  }
}

/** Width and height of one repeat of the pattern in px. */
export function patternTileSize(p: Pattern): { width: number; height: number } {
  const t = tileOf(p.motif, p.size, p.weight, p.seed);
  return { width: t.w, height: t.h };
}

/** The <pattern> for a pattern fill over a w×h box (centered on it). */
export function patternDef(p: Pattern, id: string, w: number, h: number): ReactElement {
  const tile = tileOf(p.motif, Math.max(1, p.size), p.weight, p.seed);
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
