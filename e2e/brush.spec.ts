// ブラシ・鉛筆・消しゴム (2026-11-09): strokes kept on the image as edits (筆跡を記録),
// on the selected image or, with none, on a new transparent image the size of the canvas.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canvasBox, decodePixels, disableNativePickers, drag, makePng, setColor, state, waitImagesIdle } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

const props = (page: Page) => page.getByRole('region', { name: 'プロパティ' });

async function exportPng(page: Page, points: [number, number][]) {
  await waitImagesIdle(page);
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByLabel('PNG', { exact: true }).check();
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  return (await decodePixels(page, readFileSync((await (await dl).path())!), 'image/png', points)).px;
}

type Img = { type: string; box: { x: number; y: number; width: number; height: number }; pipeline: { localEdits: { kind: string; tool: string }[] } };
const objects = (page: Page) => state<Img[]>(page, 's => s.doc.layers[0].children');

async function setSize(page: Page, label: string, v: string) {
  const i = props(page).locator(`input[aria-label="${label}"]`);
  await i.fill(v);
  await i.press('Enter');
}

test('the brush with nothing selected draws on a new transparent image; more strokes go onto it; undo', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('b');
  await expect(page.locator('.toolbar [data-tool="brush"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(props(page).getByTestId('stroke-tool-panel')).toContainText('新しい透明な画像');
  await setColor(page, props(page), 'ブラシの色', '#ff0000');
  await setSize(page, 'ブラシのサイズ', '20');
  await setSize(page, 'ブラシの硬さ', '100');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 300, y: c.y + 100 });
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  let o = (await objects(page))[0];
  expect(o.type).toBe('image');
  expect(o.box).toMatchObject({ x: 0, y: 0, width: 800, height: 600 });
  expect(o.pipeline.localEdits.map((e) => e.tool)).toEqual(['brush']);
  // A second stroke goes onto the same image.
  await drag(page, { x: c.x + 100, y: c.y + 200 }, { x: c.x + 300, y: c.y + 200 });
  o = (await objects(page))[0];
  expect((await objects(page)).length).toBe(1);
  expect(o.pipeline.localEdits).toHaveLength(2);
  const px = await exportPng(page, [[200, 100], [200, 108], [200, 115], [200, 150], [200, 200]]);
  expect(px[0]).toEqual([255, 0, 0, 255]); // on the stroke
  expect(px[1]).toEqual([255, 0, 0, 255]); // within its 20 px
  expect(px[2]).toEqual([255, 255, 255, 255]); // outside (white canvas)
  expect(px[3]).toEqual([255, 255, 255, 255]);
  expect(px[4]).toEqual([255, 0, 0, 255]);
  await page.keyboard.press('Control+z');
  expect((await objects(page))[0].pipeline.localEdits).toHaveLength(1);
});

test('the eraser clears pixels of the selected image (non-destructively); the pencil draws hard 1 px lines', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /画像を配置/ }).click();
  await (await chooser).setFiles({ name: 'blue.png', mimeType: 'image/png', buffer: makePng(200, 100, () => [0, 0, 255, 255]) });
  await expect(page.locator('[data-testid=canvas] image')).toHaveCount(1);
  const c = await canvasBox(page);
  // Placed at (300, 250)–(500, 350).
  await page.keyboard.press('e');
  await expect(props(page).getByTestId('stroke-tool-panel')).toContainText('blue.png');
  await setSize(page, '消しゴムのサイズ', '20');
  await setSize(page, '消しゴムの硬さ', '100');
  await drag(page, { x: c.x + 320, y: c.y + 300 }, { x: c.x + 480, y: c.y + 300 });
  await expect.poll(async () => (await objects(page))[0].pipeline.localEdits.length).toBe(1);
  // Pencil: 1 px, black.
  await page.keyboard.press('b');
  await page.keyboard.press('b');
  await expect(page.locator('.toolbar [data-tool="pencil"]')).toHaveAttribute('aria-pressed', 'true');
  await drag(page, { x: c.x + 310, y: c.y + 330 }, { x: c.x + 490, y: c.y + 330 });
  await expect.poll(async () => (await objects(page))[0].pipeline.localEdits.map((e) => e.tool)).toEqual(['eraser', 'pencil']);
  const px = await exportPng(page, [[400, 300], [400, 270], [400, 329], [400, 330], [400, 331], [400, 332]]);
  expect(px[0]).toEqual([255, 255, 255, 255]); // erased: the white canvas shows
  expect(px[1]).toEqual([0, 0, 255, 255]); // untouched
  const dark = px.slice(2).map((p) => p[2] < 50);
  expect(dark.filter(Boolean)).toHaveLength(1); // one dark row: a 1 px line
  // The original pixels are kept: removing the last edits brings the image back.
  await page.keyboard.press('v');
  await page.locator('[data-testid=canvas] image').click({ position: { x: 5, y: 5 }, force: true });
  await expect(props(page).getByText(/部分加工 2 件（筆跡 2）/)).toBeVisible();
});

test('the eraser asks for an image when none is selected; the size shows around the pointer', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('e');
  await page.mouse.move(c.x + 200, c.y + 200);
  await expect(page.getByTestId('brush-cursor')).toBeVisible();
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 200, y: c.y + 100 });
  await expect(page.locator('.notice.error')).toContainText('消しゴムで消す画像を選択してください');
  await page.locator('.notice.error').click();
  expect(await objects(page)).toHaveLength(0);
});

test('in マスクの編集 the brush paints the mask (white shows, black hides)', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 400, y: c.y + 300 });
  await setColor(page, props(page), '塗り', '#ff0000');
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await page.getByRole('menuitem', { name: /マスクを追加…/ }).click();
  await page.getByRole('dialog', { name: 'マスクを追加' }).getByRole('button', { name: /黒/ }).click();
  await page.keyboard.press('b');
  await setColor(page, props(page), 'ブラシの色', '#ffffff');
  await setSize(page, 'ブラシのサイズ', '40');
  await setSize(page, 'ブラシの硬さ', '100');
  await drag(page, { x: c.x + 150, y: c.y + 200 }, { x: c.x + 250, y: c.y + 200 });
  await expect.poll(() => state(page, 's => s.doc.layers[0].children[0].mask.children.length')).toBe(1);
  expect(await state(page, 's => s.doc.layers[0].children[0].mask.children[0].type')).toBe('image');
  await page.keyboard.press('Escape');
  const px = await exportPng(page, [[200, 200], [350, 200]]);
  expect(px[0]).toEqual([255, 0, 0, 255]); // painted white in the mask: shows
  expect(px[1]).toEqual([255, 255, 255, 255]); // black mask: hidden
});

/** Rows of a screen column (from y0 down, h px) darker than mid-gray. */
async function darkRows(page: Page, x: number, y0: number, h: number) {
  const shot = await page.screenshot({ clip: { x, y: y0, width: 1, height: h } });
  const px = (await decodePixels(page, shot, 'image/png', Array.from({ length: h }, (_, i) => [0, i] as [number, number]))).px;
  return px.filter((p) => p[0] < 128).length;
}

for (const hardness of ['0', '60', '100']) {
  test(`the stroke keeps its width when released (硬さ ${hardness} %)`, async ({ page }) => {
    await page.evaluate(() => (window as unknown as { __sparca: { set(p: object): void } }).__sparca.set({ zoom: 1 }));
    const c = await canvasBox(page);
    await page.keyboard.press('b');
    await setSize(page, 'ブラシのサイズ', '40');
    await setSize(page, 'ブラシの硬さ', hardness);
    await page.mouse.move(c.x + 100, c.y + 200);
    await page.mouse.down();
    await page.mouse.move(c.x + 400, c.y + 200, { steps: 10 });
    await page.mouse.move(c.x + 500, c.y + 400); // pointer (and its circle) away from the column measured
    await page.mouse.move(c.x + 400, c.y + 200);
    const live = await darkRows(page, c.x + 250, c.y + 150, 100);
    await page.mouse.up();
    await waitImagesIdle(page);
    await expect(page.getByTestId('stroke-preview')).toHaveCount(0);
    await page.mouse.move(c.x + 600, c.y + 450);
    const done = await darkRows(page, c.x + 250, c.y + 150, 100);
    expect(done).toBeGreaterThan(10);
    expect(Math.abs(live - done)).toBeLessThanOrEqual(2);
  });
}

/** Columns of a screen row (from x0, w px) darker than mid-gray. */
async function darkCols(page: Page, x0: number, y: number, w: number) {
  const shot = await page.screenshot({ clip: { x: x0, y, width: w, height: 1 } });
  const px = (await decodePixels(page, shot, 'image/png', Array.from({ length: w }, (_, i) => [i, 0] as [number, number]))).px;
  return px.filter((p) => p[0] < 128).length;
}

test('a straight horizontal or vertical stroke shows at full width while drawn', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __sparca: { set(p: object): void } }).__sparca.set({ zoom: 1 }));
  const c = await canvasBox(page);
  await page.keyboard.press('b');
  await setSize(page, 'ブラシのサイズ', '30');
  // Horizontal: measure the width (rows) while drawing and after.
  await page.mouse.move(c.x + 100, c.y + 150);
  await page.mouse.down();
  await page.mouse.move(c.x + 400, c.y + 150, { steps: 10 });
  const liveH = await darkRows(page, c.x + 200, c.y + 110, 80);
  await page.mouse.up();
  await waitImagesIdle(page);
  await expect(page.getByTestId('stroke-preview')).toHaveCount(0);
  await page.mouse.move(c.x + 700, c.y + 500);
  const doneH = await darkRows(page, c.x + 200, c.y + 110, 80);
  expect(doneH).toBeGreaterThan(15);
  expect(Math.abs(liveH - doneH)).toBeLessThanOrEqual(2);
  // Vertical: the width is in columns.
  await page.mouse.move(c.x + 600, c.y + 100);
  await page.mouse.down();
  await page.mouse.move(c.x + 600, c.y + 400, { steps: 10 });
  const liveV = await darkCols(page, c.x + 560, c.y + 250, 80);
  await page.mouse.up();
  await waitImagesIdle(page);
  await expect(page.getByTestId('stroke-preview')).toHaveCount(0);
  await page.mouse.move(c.x + 700, c.y + 500);
  const doneV = await darkCols(page, c.x + 560, c.y + 250, 80);
  expect(doneV).toBeGreaterThan(15);
  expect(Math.abs(liveV - doneV)).toBeLessThanOrEqual(2);
});
