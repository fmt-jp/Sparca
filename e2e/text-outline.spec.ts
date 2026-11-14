// テキストのアウトライン化 (2026-11-14): a text becomes one path of its letters that looks the
// same — from the font file when the browser can read it, else by tracing.
import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { canvasBox, decodePixels, disableNativePickers, drag, state } from './helpers';

const DEJAVU = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
});

async function exportDark(page: Page): Promise<boolean[]> {
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByLabel('PNG', { exact: true }).check();
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  const bytes = readFileSync((await (await dl).path())!);
  const pts: [number, number][] = [];
  for (let y = 60; y < 200; y += 2) for (let x = 60; x < 700; x += 2) pts.push([x, y]);
  const px = (await decodePixels(page, bytes, 'image/png', pts)).px;
  return px.map((p) => p[0] < 128);
}

/** How much two sets of dark samples agree (intersection over union). */
const iou = (a: boolean[], b: boolean[]) => {
  let i = 0;
  let u = 0;
  a.forEach((v, k) => {
    if (v && b[k]) i++;
    if (v || b[k]) u++;
  });
  return u ? i / u : 1;
};

/** A text "HANABI 花火" of 80 px at (100, 80) in `family`, selected. */
async function makeText(page: Page, family: string, text = 'HANABI Ag') {
  const c = await canvasBox(page);
  await page.keyboard.press('t');
  await page.mouse.click(c.x + 100, c.y + 100);
  await expect(page.locator('textarea.text-editor')).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await page.evaluate(
    (family) => {
      const ed = (window as unknown as { __sparca: { edit(l: string, f: (d: any) => void): void; getState(): any } }).__sparca;
      ed.edit('test', (d) => {
        const t = d.layers[0].children[0];
        t.fontFamily = family;
        t.fontSize = 80;
        t.color = '#000000';
        t.box = { ...t.box, x: 100, y: 80, width: 520, height: 100 };
      });
    },
    family,
  );
  await page.keyboard.press('v');
  await page.keyboard.press('Control+a');
}

type Path = { type: string; nodes: { in: unknown; out: unknown }[]; subpaths?: unknown[]; fill: unknown };

test('a generic-family text is traced into one path that looks the same; undo brings the text back', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
  await makeText(page, 'sans-serif');
  await page.evaluate(() => (window as unknown as { __sparca: { set(p: object): void } }).__sparca.set({ zoom: 1 }));
  const before = await exportDark(page);
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await page.getByRole('menuitem', { name: /テキストをアウトライン化/ }).click();
  await expect.poll(() => state<string>(page, 's => s.doc.layers[0].children[0].type')).toBe('path');
  await expect(page.locator('.notice', { hasText: 'なぞってアウトライン化' })).toBeVisible();
  const o = await state<Path>(page, 's => s.doc.layers[0].children[0]');
  expect(o.fill).toBe('#000000');
  expect((o.subpaths ?? []).length).toBeGreaterThan(5); // letters and their holes
  const after = await exportDark(page);
  expect(iou(before, after)).toBeGreaterThan(0.93);
  await page.keyboard.press('Control+z');
  expect(await state<string>(page, 's => s.doc.layers[0].children[0].type')).toBe('text');
});

test('with the font file (Local Font Access) the outlines are the font’s own curves; Ctrl+Shift+O', async ({ page }) => {
  test.skip(!existsSync(DEJAVU), 'DejaVu Sans is not installed');
  const b64 = readFileSync(DEJAVU).toString('base64');
  // The browser's font access, answering with the installed DejaVu Sans file.
  await page.addInitScript((b64: string) => {
    (window as unknown as Record<string, unknown>).queryLocalFonts = async () => [
      {
        family: 'DejaVu Sans',
        postscriptName: 'DejaVuSans',
        style: 'Book',
        blob: async () => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]),
      },
    ];
  }, b64);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
  await makeText(page, 'DejaVu Sans');
  await page.evaluate(() => (window as unknown as { __sparca: { set(p: object): void } }).__sparca.set({ zoom: 1 }));
  const before = await exportDark(page);
  await page.keyboard.press('Control+Shift+O');
  await expect.poll(() => state<string>(page, 's => s.doc.layers[0].children[0].type')).toBe('path');
  await expect(page.locator('.notice', { hasText: 'なぞって' })).toHaveCount(0); // not traced
  const o = await state<Path>(page, 's => s.doc.layers[0].children[0]');
  const all = [o.nodes, ...((o.subpaths ?? []) as { nodes: Path['nodes'] }[]).map((s) => s.nodes)].flat();
  expect(all.some((n) => n.in || n.out)).toBe(true); // curves, not traced corners
  expect(all.length).toBeLessThan(600);
  const after = await exportDark(page);
  // Exact placement (checked by eye: the outline covers the text with no fringe); the rest is
  // anti-aliasing of hinted text versus a filled path.
  expect(iou(before, after)).toBeGreaterThan(0.95);
});

/** A font collection (.ttc) of the given font files: directories first, then each font's tables. */
function collection(fonts: Buffer[]): Buffer {
  const dirs = fonts.map((f) => 12 + 16 * f.readUInt16BE(4));
  const head = 12 + 4 * fonts.length;
  const dirStart: number[] = [];
  let at = head;
  for (const d of dirs) {
    dirStart.push(at);
    at += d;
  }
  const parts: Buffer[] = [];
  const out = Buffer.alloc(at);
  out.write('ttcf', 0, 'latin1');
  out.writeUInt32BE(0x00010000, 4);
  out.writeUInt32BE(fonts.length, 8);
  fonts.forEach((f, i) => {
    out.writeUInt32BE(dirStart[i], 12 + 4 * i);
    const n = f.readUInt16BE(4);
    f.copy(out, dirStart[i], 0, 12);
    for (let t = 0; t < n; t++) {
      const r = 12 + 16 * t;
      f.copy(out, dirStart[i] + r, r, r + 16);
      const off = f.readUInt32BE(r + 8);
      const len = f.readUInt32BE(r + 12);
      // Table data goes after everything so far; offsets count from the start of the file.
      out.writeUInt32BE(at, dirStart[i] + r + 8);
      const data = Buffer.alloc((len + 3) & ~3);
      f.copy(data, 0, off, off + len);
      parts.push(data);
      at += data.length;
    }
  });
  return Buffer.concat([out, ...parts]);
}

test('a font in a collection (.ttc) is found by its PostScript name', async ({ page }) => {
  test.skip(!existsSync(DEJAVU), 'DejaVu Sans is not installed');
  const ttc = collection([readFileSync(DEJAVU.replace('DejaVuSans.ttf', 'DejaVuSans-Bold.ttf')), readFileSync(DEJAVU)]);
  await page.addInitScript((b64: string) => {
    (window as unknown as Record<string, unknown>).queryLocalFonts = async () => [
      { family: 'DejaVu Sans', postscriptName: 'DejaVuSans', style: 'Book', blob: async () => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]) },
    ];
  }, ttc.toString('base64'));
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
  await makeText(page, 'DejaVu Sans');
  await page.evaluate(() => (window as unknown as { __sparca: { set(p: object): void } }).__sparca.set({ zoom: 1 }));
  const before = await exportDark(page);
  await page.keyboard.press('Control+Shift+O');
  await expect.poll(() => state<string>(page, 's => s.doc.layers[0].children[0].type')).toBe('path');
  await expect(page.locator('.notice', { hasText: 'なぞって' })).toHaveCount(0);
  // The regular face (second in the collection), not the bold one (first).
  expect(iou(before, await exportDark(page))).toBeGreaterThan(0.95);
});

test('outlined text can be combined with a shape (パスの結合)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
  await makeText(page, 'sans-serif', 'I');
  await page.keyboard.press('Control+Shift+O');
  await expect.poll(() => state<string>(page, 's => s.doc.layers[0].children[0].type')).toBe('path');
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 80, y: c.y + 150 }, { x: c.x + 300, y: c.y + 170 });
  await page.keyboard.press('v');
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await page.getByRole('menuitem', { name: 'パスの結合', exact: true }).hover();
  await page.getByRole('menuitem', { name: '合体', exact: true }).click();
  await expect.poll(() => state<number>(page, 's => s.doc.layers[0].children.length')).toBe(1);
});
