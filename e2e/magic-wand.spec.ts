// 自動選択ツール (2026-11-15): click → the area of like color (as the canvas shows it).
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { decodePixels, disableNativePickers, drag, makePng, setColor, state, waitImagesIdle } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __sparca: { set(p: object): void } }).__sparca.set({ zoom: 1 }));
});

const props = (page: Page) => page.getByRole('region', { name: 'プロパティ' });
type Sel = { kind: string; points: { x: number; y: number }[]; more?: { x: number; y: number }[][] } | null;
const selection = (page: Page) => state<Sel>(page, 's => s.pixelSelection');
const bounds = (pts: { x: number; y: number }[]) => ({
  x0: Math.min(...pts.map((p) => p.x)),
  x1: Math.max(...pts.map((p) => p.x)),
  y0: Math.min(...pts.map((p) => p.y)),
  y1: Math.max(...pts.map((p) => p.y)),
});

/** Red rects at (100,100)–(200,180) and (400,100)–(500,180), a blue one at (250,300)–(350,380). */
async function shapes(page: Page) {
  const ws = (await page.locator('.overlay').boundingBox())!;
  for (const [x0, y0, x1, y1, color] of [
    [100, 100, 200, 180, '#ff0000'],
    [400, 100, 500, 180, '#ff0000'],
    [250, 300, 350, 380, '#0000ff'],
  ] as const) {
    await page.keyboard.press('r');
    await drag(page, { x: ws.x + x0, y: ws.y + y0 }, { x: ws.x + x1, y: ws.y + y1 });
    await setColor(page, props(page), '塗り', color);
  }
  await page.keyboard.press('Escape');
  return (x: number, y: number) => ({ x: ws.x + x, y: ws.y + y });
}

test('a click selects the connected area of like color; without 隣接 every like area; Shift adds', async ({ page }) => {
  const at = await shapes(page);
  await page.keyboard.press('w');
  await expect(page.locator('.toolbar [data-tool="wand"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(props(page).getByTestId('wand-panel')).toBeVisible();
  let p = at(150, 140);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await selection(page))?.kind).toBe('polygon');
  let s = (await selection(page))!;
  expect(s.more ?? []).toHaveLength(0);
  const b = bounds(s.points);
  expect([b.x0, b.y0, b.x1, b.y1].map(Math.round)).toEqual([100, 100, 200, 180]);
  await expect(page.getByTestId('pixel-selection')).toHaveCount(1);
  // 隣接 off: both red rects.
  await props(page).getByLabel('隣接する範囲のみ').uncheck();
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => ((await selection(page))?.more ?? []).length).toBe(1);
  // Shift+click on the blue one adds it.
  p = at(300, 340);
  await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => ((await selection(page))?.more ?? []).length).toBe(2);
  // The white around (connected) has the rects as holes.
  await props(page).getByLabel('隣接する範囲のみ').check();
  p = at(20, 20);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => ((await selection(page))?.more ?? []).length).toBe(3);
  s = (await selection(page))!;
  expect(bounds(s.points)).toMatchObject({ x0: 0, y0: 0, x1: 800, y1: 600 });
});

test('the tolerance decides how alike; the selection works with 選択範囲を消去 on an image', async ({ page }) => {
  // A photo: a red disk on a slightly uneven white.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /画像を配置/ }).click();
  const png = makePng(200, 200, (x, y) => (Math.hypot(x - 100, y - 100) < 50 ? [220, 30, 30, 255] : [250 - ((x + y) % 7), 250, 250, 255]));
  await (await chooser).setFiles({ name: 'disk.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('[data-testid=canvas] image')).toHaveCount(1);
  await waitImagesIdle(page);
  const ws = (await page.locator('.overlay').boundingBox())!;
  await page.keyboard.press('w');
  const tol = props(page).locator('input[aria-label="自動選択の許容値"]');
  await tol.fill('0');
  await tol.press('Enter');
  // Tolerance 0 on the uneven white: only bits of it.
  await page.mouse.click(ws.x + 310, ws.y + 260);
  await expect.poll(async () => (await selection(page))?.kind).toBe('polygon');
  const tiny = bounds((await selection(page))!.points);
  expect(tiny.x1 - tiny.x0).toBeLessThan(50);
  await tol.fill('32');
  await tol.press('Enter');
  // The disk (image placed at 300,200): select and erase it.
  await page.mouse.click(ws.x + 400, ws.y + 300);
  // The disk is 99 px across (pixel centers within radius 50).
  await expect.poll(async () => Math.round(bounds((await selection(page))!.points).x1 - bounds((await selection(page))!.points).x0)).toBe(99);
  await page.keyboard.press('Delete');
  await expect.poll(() => state<number>(page, 's => s.doc.layers[0].children[0].pipeline.localEdits.length')).toBe(1);
  await waitImagesIdle(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByLabel('PNG', { exact: true }).check();
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  const px = (await decodePixels(page, readFileSync((await (await dl).path())!), 'image/png', [[400, 300], [430, 330], [310, 210]])).px;
  expect(px[0]).toEqual([255, 255, 255, 255]); // the disk is gone (white canvas shows)
  expect(px[1]).toEqual([255, 255, 255, 255]);
  expect(px[2][0]).toBeGreaterThan(240); // the white around stays
});
