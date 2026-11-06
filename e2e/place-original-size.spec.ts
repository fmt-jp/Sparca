// Placed / pasted images keep their original pixel size; one larger than the canvas asks
// whether to keep its size (sticking out, with a notice) or scale it down to fit — the
// answer can be remembered and changed in the ファイル menu.
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
  const dlg = page.getByRole('dialog', { name: '画像の配置' });
  await expect(dlg).toContainText(`${W} × ${H} px`);
  await dlg.getByRole('button', { name: '原寸で配置' }).click();
  await expect(dlg).toHaveCount(0);
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

const lastBox = (page: import('@playwright/test').Page) => state<Box>(page, 's => s.doc.layers[s.doc.layers.length - 1].children.at(-1).box');
const count = (page: import('@playwright/test').Page) => state<number>(page, 's => s.doc.layers.flatMap(l => l.children).length');

test('キャンバスに合わせる scales a large image down to fit, centered, keeping its pixels', async ({ page }) => {
  const doc = await state<{ w: number; h: number }>(page, 's => ({ w: s.doc.width, h: s.doc.height })');
  const W = doc.w * 2;
  const H = doc.h;
  await place(page, 'wide.png', W, H);
  await page.getByRole('dialog', { name: '画像の配置' }).getByRole('button', { name: 'キャンバスに合わせる' }).click();
  await expect(page.locator('[data-testid=canvas] image')).toHaveCount(1);
  const b = await lastBox(page);
  expect([b.width, b.height]).toEqual([doc.w, Math.round(H / 2)]);
  expect(b.x).toBe(0);
  expect(b.y).toBe(Math.round((doc.h - b.height) / 2));
  // The pixels are kept (no 画像サイズ step), and no overflow notice.
  expect(await state(page, 's => s.doc.layers.flatMap(l => l.children).at(-1).pipeline.resize')).toBeNull();
  await expect(page.locator('.notice')).toHaveCount(0);
});

test('cancel places nothing; a remembered answer is used without asking and can be changed in the ファイル menu', async ({ page }) => {
  const doc = await state<{ w: number; h: number }>(page, 's => ({ w: s.doc.width, h: s.doc.height })');
  await place(page, 'big.png', doc.w + 10, doc.h + 10);
  await page.getByRole('dialog', { name: '画像の配置' }).getByRole('button', { name: 'キャンセル' }).click();
  expect(await count(page)).toBe(0);
  // Remember 「キャンバスに合わせる」.
  await place(page, 'big.png', doc.w + 10, doc.h + 10);
  const dlg = page.getByRole('dialog', { name: '画像の配置' });
  await dlg.getByLabel(/次回から確認しない/).check();
  await dlg.getByRole('button', { name: 'キャンバスに合わせる' }).click();
  expect(await state(page, 's => s.imagePlacement')).toBe('fit');
  await page.reload();
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
  await place(page, 'big2.png', doc.w * 2, doc.h * 2);
  await expect(page.locator('[data-testid=canvas] image')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: '画像の配置' })).toHaveCount(0);
  expect((await lastBox(page)).width).toBe(doc.w);
  // ファイル menu: back to 毎回確認.
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'キャンバスより大きい画像：毎回確認' }).click();
  expect(await state(page, 's => s.imagePlacement')).toBe('ask');
  await place(page, 'big3.png', doc.w + 10, doc.h + 10);
  await expect(page.getByRole('dialog', { name: '画像の配置' })).toBeVisible();
});
