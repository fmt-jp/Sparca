// 線のグラデーション and パターンの塗り, set from the properties panel and checked in the exported PNG.
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
const first = <T,>(page: Page, key: string) => state<T>(page, `s => s.doc.layers[0].children[0].${key}`);

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

/** A rectangle at (100,100)–(400,300) on the white 800×600 canvas. */
async function rect(page: Page) {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 400, y: c.y + 300 });
  return c;
}

const isReddish = (p: number[]) => p[0] > 180 && p[2] < 80;
const isBluish = (p: number[]) => p[2] > 180 && p[0] < 80;
const isWhite = (p: number[]) => p[0] > 240 && p[1] > 240 && p[2] > 240;
const isMotif = (p: number[]) => Math.abs(p[0] - 0x4a) < 12 && Math.abs(p[1] - 0x90) < 12 && Math.abs(p[2] - 0xe2) < 12;

test('線のグラデーション: the stroke runs red to blue, has its own handles, and undoes in one step', async ({ page }) => {
  await rect(page);
  await props(page).getByLabel('線の種類').selectOption('linear');
  expect(await first<{ kind: string }>(page, 'stroke')).toMatchObject({ kind: 'linear' });
  await setNumber(page, '線幅', '12');
  await props(page).getByRole('button', { name: /^線の色1/ }).click();
  await setColor(page, props(page), 'グラデーションの色', '#ff0000');
  await props(page).getByRole('button', { name: /^線の色2/ }).click();
  await setColor(page, props(page), 'グラデーションの色', '#0000ff');
  // The fill stays a plain color; the canvas shows the stroke gradient's handles.
  expect(await first<string>(page, 'fill')).toBe('#4a90e2');
  await expect(page.getByTestId('gradient-handles')).toBeVisible();
  const px = await exportPng(page, [[98, 200], [402, 200], [250, 200]]);
  expect(isReddish(px[0])).toBe(true); // left edge of the stroke
  expect(isBluish(px[1])).toBe(true); // right edge
  expect(isMotif(px[2])).toBe(true); // the fill inside
  // Back to a single color.
  await props(page).getByLabel('線の種類').selectOption('solid');
  expect(await first<string>(page, 'stroke')).toBe('#ff0000');
  await page.keyboard.press('Control+z');
  expect(await first<{ kind: string }>(page, 'stroke')).toMatchObject({ kind: 'linear' });
});

test('a line can have a gradient stroke too', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('n');
  await drag(page, { x: c.x + 100, y: c.y + 200 }, { x: c.x + 400, y: c.y + 200 });
  await props(page).getByLabel('線の種類').selectOption('linear');
  await props(page).getByRole('button', { name: /^線の色1/ }).click();
  await setColor(page, props(page), 'グラデーションの色', '#ff0000');
  await props(page).getByRole('button', { name: /^線の色2/ }).click();
  await setColor(page, props(page), 'グラデーションの色', '#0000ff');
  const px = await exportPng(page, [[110, 200], [390, 200]]);
  expect(isReddish(px[0])).toBe(true);
  expect(isBluish(px[1])).toBe(true);
});

test('パターン: 市松 tiles are centered on the shape, and keep their size when it is resized', async ({ page }) => {
  await rect(page);
  await props(page).getByLabel('塗りの種類').selectOption('pattern');
  await props(page).getByRole('radiogroup', { name: '塗りの柄' }).getByRole('radio', { name: '市松' }).click();
  await setNumber(page, '柄の大きさ', '40');
  expect(await first<object>(page, 'fill')).toMatchObject({ kind: 'pattern', motif: 'ichimatsu', color: '#4a90e2', background: '#ffffff', size: 40 });
  // The box center (250,200) is a corner of 20 px cells: motif top-left and bottom-right of it.
  let px = await exportPng(page, [[240, 190], [260, 190], [260, 210], [240, 210], [120, 120]]);
  expect(isMotif(px[0])).toBe(true);
  expect(isWhite(px[1])).toBe(true);
  expect(isMotif(px[2])).toBe(true);
  expect(isWhite(px[3])).toBe(true);
  // 2 tiles left of the center: the same as at the center.
  expect(isMotif(px[4]) || isWhite(px[4])).toBe(true);
  // Make the shape larger around its center: the cells stay 20 px.
  await setNumber(page, '幅', '400');
  await setNumber(page, 'X', '50');
  px = await exportPng(page, [[240, 190], [260, 190], [60, 190], [80, 190]]);
  expect(isMotif(px[0])).toBe(true);
  expect(isWhite(px[1])).toBe(true);
  // 190 px left of the center is 10 cells over (the other color), 170 px is 9 (the same).
  expect(isWhite(px[2])).toBe(true);
  expect(isMotif(px[3])).toBe(true);
  // Choosing another motif gives it its usual thickness; motifs without one hide the setting.
  await props(page).getByRole('radiogroup', { name: '塗りの柄' }).getByRole('radio', { name: '水玉' }).click();
  expect(await first<{ motif: string; weight: number }>(page, 'fill')).toMatchObject({ motif: 'dots', weight: 0.5 });
  await expect(props(page).locator('input[type="text"][aria-label="柄の太さ"]')).toHaveCount(1);
  await props(page).getByRole('radiogroup', { name: '塗りの柄' }).getByRole('radio', { name: '市松' }).click();
  await expect(props(page).locator('input[type="text"][aria-label="柄の太さ"]')).toHaveCount(0); // 市松 has no thickness
});

test('text can be filled with a pattern; the color field remembers the motif color', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('t');
  await page.mouse.click(c.x + 100, c.y + 100);
  await page.keyboard.type('柄');
  await page.keyboard.press('Escape');
  await props(page).getByLabel('文字色の種類').selectOption('pattern');
  expect(await first<{ kind: string }>(page, 'color')).toMatchObject({ kind: 'pattern', motif: 'stripes' });
  await expect(page.locator('[data-testid=canvas] text[fill^="url(#"]')).toHaveCount(1);
  await props(page).getByLabel('文字色の種類').selectOption('solid');
  expect(typeof (await first<unknown>(page, 'color'))).toBe('string');
});
