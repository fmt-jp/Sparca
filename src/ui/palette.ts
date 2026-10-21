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
