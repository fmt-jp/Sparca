import { expect, test, type Page } from '@playwright/test';
import { canvasBox, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

type Box = { x: number; y: number; width: number; height: number };
const textBox = (page: Page) => state<Box>(page, 's => s.doc.layers[0].children[0].box');
const props = (page: Page) => page.getByRole('region', { name: 'プロパティ' });

async function addText(page: Page, value: string) {
  const c = await canvasBox(page);
  await page.keyboard.press('t');
  await page.mouse.click(c.x + 300, c.y + 200);
  await expect(page.locator('textarea.text-editor')).toBeFocused();
  await page.keyboard.type(value);
  await page.keyboard.press('Escape');
  await page.mouse.click(c.x + 700, c.y + 500);
  await page.mouse.click(c.x + 310, c.y + 205);
  expect(await state<string[]>(page, 's => s.selection')).toHaveLength(1);
  return c;
}

async function setFontSize(page: Page, v: number) {
  const input = props(page).locator('input[aria-label="フォントサイズ"]');
  await input.fill(String(v));
  await input.press('Enter');
}

for (const [align, f] of [
  ['中央揃え', 0.5],
  ['右揃え', 1],
  ['左揃え', 0],
] as const) {
  test(`changing the font size keeps the ${align} point in place`, async ({ page }) => {
    await addText(page, 'Sparca テキスト');
    await props(page).getByTitle(align, { exact: true }).click();
    const before = await textBox(page);
    await setFontSize(page, 72);
    const after = await textBox(page);
    expect(after.width).toBeGreaterThan(before.width * 1.5);
    expect(after.x + after.width * f).toBeCloseTo(before.x + before.width * f, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
    // Smaller again: still anchored at the same point.
    await setFontSize(page, 12);
    const small = await textBox(page);
    expect(small.x + small.width * f).toBeCloseTo(before.x + before.width * f, 3);
  });
}

test('editing centered text keeps it centered on the same point', async ({ page }) => {
  const c = await addText(page, 'abc');
  await props(page).getByTitle('中央揃え', { exact: true }).click();
  const before = await textBox(page);
  await page.mouse.dblclick(c.x + 310, c.y + 205);
  const ta = page.locator('textarea.text-editor');
  await expect(ta).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type('defghijk');
  await page.keyboard.press('Escape');
  const after = await textBox(page);
  expect(after.width).toBeGreaterThan(before.width);
  expect(after.x + after.width / 2).toBeCloseTo(before.x + before.width / 2, 3);
});
