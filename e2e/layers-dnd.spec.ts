// Dragging in the layers panel drops on the line between rows: the upper half of a row
// means "above it", the lower half "below it".
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, drag, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** Layer names (bottom first) with their objects' names (bottom first). */
const layout = (page: Page) => state<[string, string[]][]>(page, 's => s.doc.layers.map(l => [l.name, l.children.map(o => o.name)])');

/** Rows are 20+ px tall; y = 3 is the upper half, y = height - 3 the lower half. */
async function dropOn(page: Page, source: string, target: string, half: 'upper' | 'lower') {
  const t = page.locator(target);
  const h = (await t.boundingBox())!.height;
  await page.locator(source).dragTo(t, { targetPosition: { x: 60, y: half === 'upper' ? 3 : h - 3 } });
}

/** Layer 1 with 矩形, 楕円 and a text (top), plus empty layers 2 and 3 above — as in the report. */
async function setup(page: Page) {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 50, y: c.y + 50 }, { x: c.x + 150, y: c.y + 150 });
  await page.keyboard.press('r');
  await page.keyboard.press('r'); // rounded rect
  await page.keyboard.press('r'); // ellipse
  await drag(page, { x: c.x + 200, y: c.y + 50 }, { x: c.x + 300, y: c.y + 150 });
  await page.keyboard.press('t');
  await page.mouse.click(c.x + 400, c.y + 300);
  await page.keyboard.type('HANABI');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '新規レイヤー' }).click();
  await page.getByRole('button', { name: '新規レイヤー' }).click();
  expect(await layout(page)).toEqual([
    ['レイヤー 1', ['矩形', '楕円', 'テキスト']],
    ['レイヤー 2', []],
    ['レイヤー 3', []],
  ]);
}

test('an object dropped on the line between two layers goes to the bottom of the upper layer', async ({ page }) => {
  await setup(page);
  // Between レイヤー 2 and レイヤー 1 = upper half of レイヤー 1's row → into レイヤー 2.
  await dropOn(page, '[data-object-row="テキスト"]', '[data-layer-row="レイヤー 1"]', 'upper');
  await expect(page.locator('[data-layer-row="レイヤー 1"]')).not.toHaveClass(/drop-/);
  expect(await layout(page)).toEqual([
    ['レイヤー 1', ['矩形', '楕円']],
    ['レイヤー 2', ['テキスト']],
    ['レイヤー 3', []],
  ]);
  expect(await state<string>(page, 's => s.doc.layers.find(l => l.id === s.activeLayerId).name')).toBe('レイヤー 2');
  // Lower half of a layer's row (just under its name) → the top of that layer.
  await dropOn(page, '[data-object-row="楕円"]', '[data-layer-row="レイヤー 2"]', 'lower');
  expect(await layout(page)).toEqual([
    ['レイヤー 1', ['矩形']],
    ['レイヤー 2', ['テキスト', '楕円']],
    ['レイヤー 3', []],
  ]);
  // Upper half of the topmost layer's row → the top of that layer.
  await dropOn(page, '[data-object-row="矩形"]', '[data-layer-row="レイヤー 3"]', 'upper');
  expect(await layout(page)).toEqual([
    ['レイヤー 1', []],
    ['レイヤー 2', ['テキスト', '楕円']],
    ['レイヤー 3', ['矩形']],
  ]);
  // One undo per move.
  await page.keyboard.press('Control+z');
  expect((await layout(page))[0]).toEqual(['レイヤー 1', ['矩形']]);
});

test('objects drop above or below another object; layers above or below another layer', async ({ page }) => {
  await setup(page);
  // テキスト (top) onto the lower half of 楕円 → just below 楕円.
  await dropOn(page, '[data-object-row="テキスト"]', '[data-object-row="楕円"]', 'lower');
  expect((await layout(page))[0][1]).toEqual(['矩形', 'テキスト', '楕円']);
  // 矩形 onto the upper half of 楕円 → just above 楕円 (the top).
  await dropOn(page, '[data-object-row="矩形"]', '[data-object-row="楕円"]', 'upper');
  expect((await layout(page))[0][1]).toEqual(['テキスト', '楕円', '矩形']);
  // Layers: レイヤー 1 onto the upper half of レイヤー 3 → topmost; then レイヤー 3 below レイヤー 2.
  await dropOn(page, '[data-layer-row="レイヤー 1"]', '[data-layer-row="レイヤー 3"]', 'upper');
  expect((await layout(page)).map((l) => l[0])).toEqual(['レイヤー 2', 'レイヤー 3', 'レイヤー 1']);
  await dropOn(page, '[data-layer-row="レイヤー 3"]', '[data-layer-row="レイヤー 2"]', 'lower');
  expect((await layout(page)).map((l) => l[0])).toEqual(['レイヤー 3', 'レイヤー 2', 'レイヤー 1']);
});
