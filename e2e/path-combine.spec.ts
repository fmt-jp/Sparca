// 変更 → パスの結合（合体・型抜き・交差・中マド）with the real geometry (paper.js).
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canvasBox, decodePixels, disableNativePickers, drag, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

type Obj = { id: string; type: string; box: { x: number; y: number; width: number; height: number }; subpaths?: unknown[]; fill: unknown };
const objects = (page: Page) => state<Obj[]>(page, 's => s.doc.layers[0].children');
const setTool = (page: Page, tool: string) =>
  page.evaluate((t) => (window as unknown as { __sparca: { setTool(t: string): void } }).__sparca.setTool(t), tool);

async function draw(page: Page, tool: string, x0: number, y0: number, x1: number, y1: number) {
  const c = await canvasBox(page);
  await setTool(page, tool);
  await drag(page, { x: c.x + x0, y: c.y + y0 }, { x: c.x + x1, y: c.y + y1 });
}

async function combine(page: Page, op: string) {
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await page.getByRole('menuitem', { name: `パスの結合：${op}` }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
}

/** Rendered pixels of the canvas (PNG export). */
async function pixels(page: Page, points: [number, number][]) {
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByLabel('PNG', { exact: true }).check();
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  return (await decodePixels(page, readFileSync((await (await dl).path())!), 'image/png', points)).px;
}

const isWhite = (p: number[]) => p[0] > 240 && p[1] > 240 && p[2] > 240;

test('型抜き: the ellipse on top punches a hole into the rectangle below (a compound path)', async ({ page }) => {
  await draw(page, 'rect', 100, 100, 300, 300);
  const rectId = (await objects(page))[0].id;
  await draw(page, 'ellipse', 150, 150, 250, 250);
  await combine(page, '型抜き');
  const [o] = await objects(page);
  expect(o).toMatchObject({ id: rectId, type: 'path', fill: '#4a90e2' });
  expect(o.subpaths).toHaveLength(1);
  expect(o.box).toMatchObject({ x: 100, y: 100, width: 200, height: 200 });
  const px = await pixels(page, [[200, 200], [120, 120], [280, 200], [350, 350]]);
  expect(isWhite(px[0])).toBe(true); // the hole
  expect(isWhite(px[1])).toBe(false); // the rest of the rectangle
  expect(isWhite(px[2])).toBe(false);
  expect(isWhite(px[3])).toBe(true); // outside
  expect(await state<string>(page, 's => s.history.past.at(-1).label')).toBe('パスの型抜き');
  // One undo brings both shapes back.
  await page.keyboard.press('Control+z');
  expect((await objects(page)).map((o) => o.type)).toEqual(['shape', 'shape']);
});

test('合体, 交差 and 中マド', async ({ page }) => {
  // Two squares overlapping in 200..300 × 200..300.
  await draw(page, 'rect', 100, 100, 300, 300);
  await draw(page, 'rect', 200, 200, 400, 400);
  await combine(page, '合体');
  expect((await objects(page))[0].box).toMatchObject({ x: 100, y: 100, width: 300, height: 300 });
  expect((await objects(page))[0].subpaths).toBeUndefined();
  let px = await pixels(page, [[150, 150], [250, 250], [350, 350], [350, 150]]);
  expect(px.map(isWhite)).toEqual([false, false, false, true]);

  await page.keyboard.press('Control+z');
  await combine(page, '交差');
  expect((await objects(page))[0].box).toMatchObject({ x: 200, y: 200, width: 100, height: 100 });
  px = await pixels(page, [[150, 150], [250, 250], [350, 350]]);
  expect(px.map(isWhite)).toEqual([true, false, true]);

  await page.keyboard.press('Control+z');
  await combine(page, '中マド');
  px = await pixels(page, [[150, 150], [250, 250], [350, 350]]);
  expect(px.map(isWhite)).toEqual([false, true, false]);
});

test('the right-click menu has パスの結合; text cannot take part', async ({ page }) => {
  await draw(page, 'ellipse', 100, 100, 200, 200);
  await draw(page, 'star', 150, 100, 250, 200);
  await page.keyboard.press('Control+a');
  const c = await canvasBox(page);
  await page.mouse.click(c.x + 200, c.y + 150, { button: 'right' });
  await page.getByRole('menuitem', { name: 'パスの結合' }).hover();
  await page.getByRole('menuitem', { name: '合体', exact: true }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  // With a text in the selection the commands are disabled.
  await setTool(page, 'text');
  await page.mouse.click(c.x + 400, c.y + 400);
  await page.keyboard.type('T');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'パスの結合：合体' })).toBeDisabled();
});

test('a compound path is edited one outline at a time with the subselect tool', async ({ page }) => {
  await draw(page, 'rect', 100, 100, 300, 300);
  await draw(page, 'rect', 150, 150, 250, 250);
  await combine(page, '型抜き');
  await page.keyboard.press('a');
  // The hole is shown as a dashed outline; click it to edit it.
  const other = page.locator('[data-contour="1"]');
  await expect(other).toHaveCount(1);
  const c = await canvasBox(page);
  await page.mouse.click(c.x + 150, c.y + 200); // on the hole's left edge
  expect(await state<number>(page, 's => s.nodeContour')).toBe(1);
  await expect(page.getByTestId('path-node-panel')).toContainText('アウトライン 2 / 2');
  await expect(page.locator('[data-contour="0"]')).toHaveCount(1);
  // Drag one of the hole's corners outwards.
  const nodes = page.locator('[data-testid="path-nodes"] [data-node]');
  await expect(nodes).toHaveCount(4);
  const corner = await state<{ x: number; y: number }>(
    page,
    's => { const o = s.doc.layers[0].children[0]; const n = o.subpaths[0].nodes[0].anchor; return { x: o.box.x + n.x * o.box.width, y: o.box.y + n.y * o.box.height }; }',
  );
  await drag(page, { x: c.x + corner.x, y: c.y + corner.y }, { x: c.x + corner.x + (corner.x < 200 ? -20 : 20), y: c.y + corner.y + (corner.y < 200 ? -20 : 20) });
  const hole = await state<{ x: number; y: number }[]>(
    page,
    's => { const o = s.doc.layers[0].children[0]; return o.subpaths[0].nodes.map(n => ({ x: o.box.x + n.anchor.x * o.box.width, y: o.box.y + n.anchor.y * o.box.height })); }',
  );
  const xs = hole.map((p) => p.x);
  expect(Math.min(...xs) < 140 || Math.max(...xs) > 260).toBe(true);
  // The outer outline is unchanged.
  expect((await objects(page))[0].box).toMatchObject({ x: 100, y: 100, width: 200, height: 200 });
});
