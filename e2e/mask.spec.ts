// グラデーションマスク: added from the properties panel or the 変更 menu, checked in the exported PNG.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canvasBox, decodePixels, disableNativePickers, drag, setColor, state } from './helpers';

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
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByLabel('PNG', { exact: true }).check();
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  return (await decodePixels(page, readFileSync((await (await dl).path())!), 'image/png', points)).px;
}

/** A red rectangle at (100,100)–(400,300) on the white canvas. */
async function redRect(page: Page, x0 = 100, y0 = 100, x1 = 400, y1 = 300) {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + x0, y: c.y + y0 }, { x: c.x + x1, y: c.y + y1 });
  await setColor(page, props(page), '塗り', '#ff0000');
  return c;
}

const isRed = (p: number[]) => p[0] > 230 && p[1] < 30 && p[2] < 30;
const isWhite = (p: number[]) => p[0] > 245 && p[1] > 245 && p[2] > 245;
const isPink = (p: number[]) => p[0] > 230 && p[1] > 60 && p[1] < 200; // half faded red on white

test('a gradient mask fades the shape from left to right; it can be turned off, moved and removed', async ({ page }) => {
  await redRect(page);
  await props(page).getByRole('button', { name: 'グラデーションマスクを追加' }).click();
  expect(await state(page, 's => s.doc.layers[0].children[0].mask.gradient.kind')).toBe('linear');
  await expect(page.getByTestId('gradient-handles')).toHaveAttribute('data-gradient-key', 'mask');
  await expect(page.locator('.mask-badge')).toHaveCount(1);
  // White (shows) at 10 % of the width, black (hidden) at 90 %.
  let px = await exportPng(page, [[110, 200], [250, 200], [395, 200]]);
  expect(isRed(px[0])).toBe(true);
  expect(isPink(px[1])).toBe(true);
  expect(isWhite(px[2])).toBe(true);
  // Turn it the other way: drag the end handle to the left edge.
  const c = await canvasBox(page);
  const end = (await page.locator('[data-gradient-handle="end"]').boundingBox())!;
  await drag(page, { x: end.x + end.width / 2, y: end.y + end.height / 2 }, { x: c.x + 100, y: c.y + 200 });
  const start = (await page.locator('[data-gradient-handle="start"]').boundingBox())!;
  await drag(page, { x: start.x + start.width / 2, y: start.y + start.height / 2 }, { x: c.x + 400, y: c.y + 200 });
  px = await exportPng(page, [[105, 200], [395, 200]]);
  expect(isWhite(px[0])).toBe(true);
  expect(isRed(px[1])).toBe(true);
  // Off: the whole shape shows again; the mask is kept.
  await props(page).getByLabel('マスクを使う').uncheck();
  px = await exportPng(page, [[105, 200], [395, 200]]);
  expect(isRed(px[0]) && isRed(px[1])).toBe(true);
  await props(page).getByLabel('マスクを使う').check();
  // Radial: the middle shows, the corners fade.
  await props(page).getByLabel('マスクの種類').selectOption('radial');
  px = await exportPng(page, [[250, 200], [103, 103]]);
  expect(isRed(px[0])).toBe(true);
  expect(isRed(px[1])).toBe(false);
  // Remove: back to the plain shape, in one undo step back.
  await props(page).getByRole('button', { name: 'マスクを削除' }).click();
  expect(await state(page, 's => s.doc.layers[0].children[0].mask ?? null')).toBeNull();
  await page.keyboard.press('Control+z');
  expect(await state(page, 's => s.doc.layers[0].children[0].mask.gradient.kind')).toBe('radial');
});

test('the mask moves with the shape', async ({ page }) => {
  const c = await redRect(page);
  await props(page).getByRole('button', { name: 'グラデーションマスクを追加' }).click();
  await page.keyboard.press('v');
  await drag(page, { x: c.x + 200, y: c.y + 200 }, { x: c.x + 300, y: c.y + 250 }); // move by (100, 50)
  const px = await exportPng(page, [[210, 250], [495, 250]]);
  expect(isRed(px[0])).toBe(true);
  expect(isWhite(px[1])).toBe(true);
});

test('a group gets a mask from the 変更 menu that covers all its members', async ({ page }) => {
  await redRect(page, 100, 100, 250, 300);
  await redRect(page, 250, 100, 400, 300);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await page.getByRole('menuitem', { name: 'グラデーションマスクを追加' }).click();
  expect(await state(page, 's => s.doc.layers[0].children[0].type')).toBe('group');
  expect(await state(page, 's => s.doc.layers[0].children[0].mask.frame')).toEqual({ x: 100, y: 100, width: 300, height: 200, rotation: 0 });
  const px = await exportPng(page, [[110, 200], [395, 200]]);
  expect(isRed(px[0])).toBe(true); // left member shows
  expect(isWhite(px[1])).toBe(true); // right member faded out
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'グラデーションマスクを追加' })).toBeDisabled();
});
