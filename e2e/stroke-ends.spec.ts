// 線の先端（丸・平ら・四角）と角（丸・尖り・面取り）, checked in the exported PNG.
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

const props = (page: Page) => page.getByRole('region', { name: 'プロパティ' });

async function setNumber(page: Page, label: string, value: string) {
  const input = props(page).locator(`input[type="text"][aria-label="${label}"]`);
  await input.fill(value);
  await input.press('Enter');
}

async function exportPng(page: Page, points: [number, number][]) {
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByLabel('PNG', { exact: true }).check();
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  return (await decodePixels(page, readFileSync((await (await dl).path())!), 'image/png', points)).px;
}

const isWhite = (p: number[]) => p[0] > 240 && p[1] > 240 && p[2] > 240;

test('line ends: round by default, then flat and square; one undo step each', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('n');
  await drag(page, { x: c.x + 100, y: c.y + 200 }, { x: c.x + 400, y: c.y + 200 });
  await setNumber(page, '線幅', '20');
  await expect(props(page).getByLabel('線の先端')).toHaveValue('round');
  // 5 px past the end on the line, and a point by the corner a square end would cover.
  const pts: [number, number][] = [[405, 200], [408, 208]];
  let px = await exportPng(page, pts);
  expect(isWhite(px[0])).toBe(false);
  expect(isWhite(px[1])).toBe(true);
  await props(page).getByLabel('線の先端').selectOption('butt');
  expect(await state(page, 's => s.doc.layers[0].children[0].strokeCap')).toBe('butt');
  px = await exportPng(page, pts);
  expect(isWhite(px[0])).toBe(true);
  expect(isWhite(px[1])).toBe(true);
  await props(page).getByLabel('線の先端').selectOption('square');
  px = await exportPng(page, pts);
  expect(isWhite(px[0])).toBe(false);
  expect(isWhite(px[1])).toBe(false);
  await page.keyboard.press('Control+z');
  expect(await state(page, 's => s.doc.layers[0].children[0].strokeCap')).toBe('butt');
});

test('corners: round by default, miter makes sharp corners; closed shapes have no end setting', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 300, y: c.y + 250 });
  await props(page).getByLabel('線の種類').selectOption('solid');
  await setNumber(page, '線幅', '20');
  await expect(props(page).getByLabel('線の先端')).toHaveCount(0);
  await expect(props(page).getByLabel('線の角')).toHaveValue('round');
  let px = await exportPng(page, [[92, 92]]);
  expect(isWhite(px[0])).toBe(true); // outside the rounded corner
  await props(page).getByLabel('線の角').selectOption('miter');
  px = await exportPng(page, [[92, 92]]);
  expect(isWhite(px[0])).toBe(false);
  await props(page).getByLabel('線の角').selectOption('bevel');
  px = await exportPng(page, [[92, 92], [93, 98]]);
  expect(isWhite(px[0])).toBe(true); // cut off
  expect(isWhite(px[1])).toBe(false);
});

test('the line tool settings take an end style for new lines', async ({ page }) => {
  await page.keyboard.press('n');
  const settings = page.getByRole('group', { name: '新しいラインの設定' });
  await settings.getByLabel('線の先端').selectOption('square');
  const c = await canvasBox(page);
  await drag(page, { x: c.x + 100, y: c.y + 300 }, { x: c.x + 300, y: c.y + 300 });
  expect(await state(page, 's => s.doc.layers[0].children[0].strokeCap')).toBe('square');
});
