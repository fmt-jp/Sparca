// Placed / pasted images keep their original pixel size (not scaled down to fit the canvas),
// so exports stay sharp; one larger than the canvas sticks out with a notice.
import { expect, test } from '@playwright/test';
import { makePng, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
});

async function place(page: import('@playwright/test').Page, name: string, w: number, h: number) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /画像を配置/ }).click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: makePng(w, h, (x) => (x % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255])) });
}

type Box = { x: number; y: number; width: number; height: number };

test('an image larger than the canvas is placed at its original size, centered on whole pixels', async ({ page }) => {
  const doc = await state<{ w: number; h: number }>(page, 's => ({ w: s.doc.width, h: s.doc.height })');
  const W = doc.w + 201;
  const H = doc.h + 100;
  await place(page, 'big.png', W, H);
  await expect(page.locator('.notice')).toContainText('原寸で配置しました');
  const b = await state<Box>(page, 's => s.doc.layers[s.doc.layers.length - 1].children.at(-1).box');
  expect(b.width).toBe(W);
  expect(b.height).toBe(H);
  expect(Number.isInteger(b.x) && Number.isInteger(b.y)).toBe(true);
  expect(b.x).toBe(Math.round((doc.w - W) / 2));
  expect(b.y).toBe(Math.round((doc.h - H) / 2));
});

test('a small image is placed at its original size without a notice', async ({ page }) => {
  await place(page, 'small.png', 41, 30);
  await expect(page.locator('[data-testid=canvas] image')).toHaveCount(1);
  const b = await state<Box>(page, 's => s.doc.layers[s.doc.layers.length - 1].children.at(-1).box');
  expect([b.width, b.height]).toEqual([41, 30]);
  await expect(page.locator('.notice')).toHaveCount(0);
});
