// グラデーションツール (G): drag over the selected object to set its gradient.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canvasBox, decodePixels, disableNativePickers, drag, makePng, placePng, setColor, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

const props = (page: Page) => page.getByRole('region', { name: 'プロパティ' });
type G = { kind: string; start: { x: number; y: number }; end: { x: number; y: number }; stops: { color: string }[] };
const first = <T,>(page: Page, key: string) => state<T>(page, `s => s.doc.layers[0].children[0].${key}`);

async function exportPng(page: Page, points: [number, number][]) {
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByLabel('PNG', { exact: true }).check();
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  return (await decodePixels(page, readFileSync((await (await dl).path())!), 'image/png', points)).px;
}

/** A red rectangle at (100,100)–(400,300), selected. */
async function redRect(page: Page) {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 400, y: c.y + 300 });
  await setColor(page, props(page), '塗り', '#ff0000');
  return c;
}

const isRed = (p: number[]) => p[0] > 230 && p[1] < 40 && p[2] < 40;
const isWhite = (p: number[]) => p[0] > 240 && p[1] > 240 && p[2] > 240;

test('dragging sets the fill gradient from the drag start to its end, in one undo step', async ({ page }) => {
  const c = await redRect(page);
  await page.keyboard.press('g');
  expect(await state(page, 's => s.tool')).toBe('gradient');
  await expect(page.getByTestId('gradient-tool-panel')).toBeVisible();
  // From the right edge (red) to the left edge (white).
  await drag(page, { x: c.x + 400, y: c.y + 200 }, { x: c.x + 100, y: c.y + 200 });
  const g = await first<G>(page, 'fill');
  expect(g.kind).toBe('linear');
  expect(g.stops.map((s) => s.color)).toEqual(['#ff0000', '#ffffff']);
  expect(g.start.x).toBeCloseTo(1, 2);
  expect(g.end.x).toBeCloseTo(0, 2);
  const px = await exportPng(page, [[398, 200], [102, 200]]);
  expect(isRed(px[0])).toBe(true);
  expect(isWhite(px[1])).toBe(true);
  // The tool stays, the handles show; a second drag keeps the colors and turns it, Shift snapping to 45°.
  expect(await state(page, 's => s.tool')).toBe('gradient');
  await expect(page.getByTestId('gradient-handles')).toHaveAttribute('data-gradient-key', 'fill');
  await page.keyboard.down('Shift');
  await drag(page, { x: c.x + 250, y: c.y + 120 }, { x: c.x + 262, y: c.y + 280 });
  await page.keyboard.up('Shift');
  const v = await first<G>(page, 'fill');
  expect(v.stops.map((s) => s.color)).toEqual(['#ff0000', '#ffffff']);
  expect(v.end.x).toBeCloseTo(v.start.x, 3); // straight down
  await page.keyboard.press('Control+z');
  expect((await first<G>(page, 'fill')).end.x).toBeCloseTo(0, 2);
  await page.keyboard.press('Control+z');
  expect(await first<string>(page, 'fill')).toBe('#ff0000');
});

test('the tool settings send the drag to the stroke or the mask', async ({ page }) => {
  const c = await redRect(page);
  await page.keyboard.press('g');
  await props(page).getByRole('radiogroup', { name: 'グラデーションの適用先' }).getByLabel('線').check();
  await drag(page, { x: c.x + 100, y: c.y + 200 }, { x: c.x + 400, y: c.y + 200 });
  expect(await first<G>(page, 'stroke')).toMatchObject({ kind: 'linear' });
  expect(await first<number>(page, 'strokeWidth')).toBe(2);
  expect(await first<string>(page, 'fill')).toBe('#ff0000');
  await props(page).getByRole('radiogroup', { name: 'グラデーションの適用先' }).getByLabel('マスク').check();
  // (Starting on a gradient handle would move that handle instead, so start off the stroke's handles.)
  await drag(page, { x: c.x + 130, y: c.y + 150 }, { x: c.x + 370, y: c.y + 150 });
  expect(await first<G>(page, 'mask.gradient')).toMatchObject({ kind: 'linear', start: { x: 0.1, y: 0.25 }, end: { x: 0.9, y: 0.25 } });
  await expect(page.getByTestId('gradient-handles')).toHaveAttribute('data-gradient-key', 'mask');
});

test('an image gets a mask; with nothing selected the object under the pointer is used', async ({ page }) => {
  await placePng(page, 'p.png', makePng(200, 100, () => [0, 128, 255, 255]));
  const box = await first<{ x: number; y: number; width: number; height: number }>(page, 'box');
  await page.keyboard.press('Escape');
  expect(await state(page, 's => s.selection.length')).toBe(0);
  await page.keyboard.press('g');
  const c = await canvasBox(page);
  await drag(page, { x: c.x + box.x + 10, y: c.y + box.y + box.height / 2 }, { x: c.x + box.x + box.width - 10, y: c.y + box.y + box.height / 2 });
  expect(await state(page, 's => s.selection.length')).toBe(1);
  expect(await first<G>(page, 'mask.gradient')).toMatchObject({ kind: 'linear' });
  expect(await first<G>(page, 'mask.gradient.stops')).toEqual([
    { offset: 0, color: '#ffffff', opacity: 1 },
    { offset: 1, color: '#000000', opacity: 1 },
  ]);
});

test('with nothing selected and nothing under the pointer it says what to do', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('g');
  await drag(page, { x: c.x + 600, y: c.y + 500 }, { x: c.x + 700, y: c.y + 500 });
  await expect(page.locator('.notice.error')).toContainText('グラデーションを付けるオブジェクトを選択');
  await page.locator('.notice.error').evaluate((el) => el.remove());
});
