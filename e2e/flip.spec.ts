// 左右反転・上下反転 (2026-11-15) from the 変更 menu, checked in the exported PNG.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canvasBox, decodePixels, disableNativePickers, drag, makePng, state, waitImagesIdle } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __sparca: { set(p: object): void } }).__sparca.set({ zoom: 1 }));
});

async function exportPng(page: Page, points: [number, number][]) {
  await waitImagesIdle(page);
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByLabel('PNG', { exact: true }).check();
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  return (await decodePixels(page, readFileSync((await (await dl).path())!), 'image/png', points)).px;
}

async function flip(page: Page, which: '左右反転' | '上下反転') {
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await page.getByRole('menuitem', { name: which }).click();
}

const isRed = (p: number[]) => p[0] > 200 && p[1] < 60 && p[2] < 60;
const isBlue = (p: number[]) => p[2] > 200 && p[0] < 60 && p[1] < 60;

test('an image flipped left–right shows mirrored (pixels kept); a brush stroke lands under the pointer; twice undoes it', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /画像を配置/ }).click();
  await (await chooser).setFiles({ name: 'rb.png', mimeType: 'image/png', buffer: makePng(200, 100, (x) => (x < 100 ? [255, 0, 0, 255] : [0, 0, 255, 255])) });
  await expect(page.locator('[data-testid=canvas] image')).toHaveCount(1);
  // Placed at (300, 250)–(500, 350): red left, blue right.
  await flip(page, '左右反転');
  expect(await state(page, 's => s.doc.layers[0].children[0].flip')).toEqual({ x: true, y: false });
  let px = await exportPng(page, [[320, 300], [480, 300]]);
  expect(isBlue(px[0])).toBe(true);
  expect(isRed(px[1])).toBe(true);
  // A white brush stroke on the left (blue) half lands there, not on the mirrored side.
  const ws = (await page.locator('.overlay').boundingBox())!;
  await page.keyboard.press('b');
  const sz = page.getByRole('region', { name: 'プロパティ' }).locator('input[aria-label="ブラシのサイズ"]');
  await sz.fill('20');
  await sz.press('Enter');
  await drag(page, { x: ws.x + 320, y: ws.y + 280 }, { x: ws.x + 330, y: ws.y + 280 });
  await expect.poll(() => state<number>(page, 's => s.doc.layers[0].children[0].pipeline.localEdits.length')).toBe(1);
  px = await exportPng(page, [[325, 280], [475, 280]]);
  expect(px[0][0]).toBeLessThan(60); // black brush on the left
  expect(isRed(px[1])).toBe(true); // nothing on the right
  await page.keyboard.press('v');
  await flip(page, '左右反転');
  expect(await state(page, 's => s.doc.layers[0].children[0].flip ?? null')).toBeNull();
});

test('two objects swap places with 左右反転; flipped text stays editable text', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 200, y: c.y + 150 });
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 500, y: c.y + 100 }, { x: c.x + 550, y: c.y + 200 });
  await page.keyboard.press('Control+a');
  await flip(page, '左右反転');
  const boxes = await state<{ x: number; width: number }[]>(page, 's => s.doc.layers[0].children.map(o => o.box)');
  expect(boxes[0].x).toBeCloseTo(450, 5); // 100..200 → 450..550 around x = 325
  expect(boxes[1].x).toBeCloseTo(100, 5);
  await page.keyboard.press('Control+z');
  // Text: mirror writing, still text and editable.
  await page.keyboard.press('Delete');
  await page.keyboard.press('t');
  await page.mouse.click(c.x + 100, c.y + 300);
  await expect(page.locator('textarea.text-editor')).toBeFocused();
  await page.keyboard.type('ABC');
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.keyboard.press('Control+a');
  await flip(page, '上下反転');
  expect(await state(page, 's => s.doc.layers[0].children[0]')).toMatchObject({ type: 'text', text: 'ABC', flip: { x: false, y: true } });
  await expect(page.locator('[data-testid=canvas] g[transform*="scale(1 -1)"]')).toHaveCount(1);
});
