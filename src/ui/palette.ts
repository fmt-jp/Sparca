// Swatch palette in the style of Fireworks / Flash: a column of grays and primaries,
// then the 216 web-safe colors as 2 × 3 blocks of 6 × 6 (red per block, green per row,
// blue per column).

const STEPS = ['00', '33', '66', '99', 'cc', 'ff'];

/** Left column: black, grays, white, then primaries and secondaries. */
export const BASIC_COLORS = [
  '#000000',
  '#333333',
  '#666666',
  '#999999',
  '#cccccc',
  '#ffffff',
  '#ff0000',
  '#00ff00',
  '#0000ff',
  '#ffff00',
  '#00ffff',
  '#ff00ff',
];

/** 12 rows × 18 columns of web-safe colors. */
export function webSafeGrid(): string[][] {
  const rows: string[][] = [];
  for (let blockRow = 0; blockRow < 2; blockRow++) {
    for (let g = 0; g < 6; g++) {
      const row: string[] = [];
      for (let blockCol = 0; blockCol < 3; blockCol++) {
        const r = blockRow * 3 + blockCol;
        for (let b = 0; b < 6; b++) row.push(`#${STEPS[r]}${STEPS[g]}${STEPS[b]}`);
      }
      rows.push(row);
    }
  }
  return rows;
}

/** Parse "#rgb", "#rrggbb", "rgb" or "rrggbb" into "#rrggbb" (lower case), or null. */
export function parseHex(text: string): string | null {
  const t = text.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(t)) return `#${[...t].map((c) => c + c).join('')}`.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(t)) return `#${t}`.toLowerCase();
  return null;
}

export interface Hsv {
  /** 0..360 */
  h: number;
  /** 0..1 */
  s: number;
  /** 0..1 */
  v: number;
}

export function hexToRgb(hex: string): [number, number, number] {
  const c = parseHex(hex) ?? '#000000';
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === R) h = 60 * (((G - B) / d) % 6);
    else if (max === G) h = 60 * ((B - R) / d + 2);
    else h = 60 * ((R - G) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const c = v * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255].map((n) => Math.round(n)) as [number, number, number];
}
