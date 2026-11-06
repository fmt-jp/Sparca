// Smart guides: while dragging, an object's center snaps to the canvas's center lines and a
// guide line shows there (表示 → スマートガイド, on by default and remembered).
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __sparca: { set(p: object): void } }).__sparca.set({ zoom: 0.5 }));
  await page.waitForTimeout(100);
});

type Box = { x: number; y: number; width: number; height: number };
const box = (page: Page) => state<Box>(page, 's => s.doc.layers[0].children[0].box');
const size = (page: Page) => state<{ w: number; h: number }>(page, 's => ({ w: s.doc.width, h: s.doc.height })');

/** Draw a 100×60 rect at doc (40, 40) and start dragging it from its middle. */
async function startDrag(page: Page) {
  const c = await canvasBox(page);
  const z = 0.5;
  const at = (x: number, y: number) => ({ x: c.x + x * z, y: c.y + y * z });
  await page.keyboard.press('r');
  const a = at(40, 40);
  const b = at(140, 100);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  const start = at(90, 70);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  return { at, start };
}

test('a dragged object snaps its center to the canvas center and shows guides', async ({ page }) => {
  const { w, h } = await size(page);
  const { at } = await startDrag(page);
  const b0 = await box(page);
  // Move the object's center to 4 doc px (2 screen px) off the canvas center, both ways.
  const cx = b0.x + b0.width / 2;
  const cy = b0.y + b0.height / 2;
  const target = at(90 + (w / 2 - cx) + 4, 70 + (h / 2 - cy) - 4);
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await expect(page.getByTestId('smart-guide-v')).toHaveCount(1);
  await expect(page.getByTestId('smart-guide-h')).toHaveCount(1);
  const b1 = await box(page);
  expect(b1.x + b1.width / 2).toBeCloseTo(w / 2, 5);
  expect(b1.y + b1.height / 2).toBeCloseTo(h / 2, 5);
  // Far from the center horizontally: only the horizontal guide remains.
  const away = at(90 + (w / 2 - cx) + 100, 70 + (h / 2 - cy));
  await page.mouse.move(away.x, away.y, { steps: 4 });
  await expect(page.getByTestId('smart-guide-v')).toHaveCount(0);
  await expect(page.getByTestId('smart-guide-h')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByTestId('smart-guide-h')).toHaveCount(0);
  const b2 = await box(page);
  expect(b2.y + b2.height / 2).toBeCloseTo(h / 2, 5);
});

test('smart guides can be turned off from the 表示 menu (remembered)', async ({ page }) => {
  await page.getByRole('button', { name: '表示', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /スマートガイド/ }).click();
  expect(await state(page, 's => s.smartGuides')).toBe(false);
  await page.reload();
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
  expect(await state(page, 's => s.smartGuides')).toBe(false);
  await page.evaluate(() => (window as unknown as { __sparca: { set(p: object): void } }).__sparca.set({ zoom: 0.5 }));
  await page.waitForTimeout(100);
  const { w, h } = await size(page);
  const { at } = await startDrag(page);
  const b0 = await box(page);
  const cx = b0.x + b0.width / 2;
  const cy = b0.y + b0.height / 2;
  const target = at(90 + (w / 2 - cx) + 4, 70 + (h / 2 - cy) - 4);
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await expect(page.getByTestId('smart-guide-v')).toHaveCount(0);
  await page.mouse.up();
  const b1 = await box(page);
  expect(Math.abs(b1.x + b1.width / 2 - w / 2)).toBeGreaterThan(2);
});
