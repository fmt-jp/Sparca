// 表示 → ルーラーを表示: rulers along the top and left, counting from the canvas's corner.
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, disableNativePickers, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
});

async function toggleFromMenu(page: Page) {
  await page.getByRole('button', { name: '表示', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'ルーラーを表示' }).click();
}

/** Whether the top ruler has a labeled (full-height) tick at screen x: only those reach its top row. */
async function tickAt(page: Page, screenX: number): Promise<boolean> {
  const ruler = page.getByTestId('ruler-x');
  const r = (await ruler.boundingBox())!;
  return ruler.evaluate((c: HTMLCanvasElement, x: number) => {
    const ctx = c.getContext('2d')!;
    const k = c.width / c.clientWidth;
    // Ticks are 1 px lines: look at the column and its neighbors, in the top row (above the labels).
    for (const dx of [-1, 0, 1]) {
      const [r, g, b] = ctx.getImageData(Math.round(x * k) + dx, Math.round(1 * k), 1, 1).data;
      if (r > 120 && g > 120 && b > 120) return true;
    }
    return false;
  }, screenX - r.x);
}

test('rulers show by default, line up with the canvas, and toggle from the 表示 menu (remembered)', async ({ page }) => {
  await expect(page.getByTestId('ruler-x')).toBeVisible();
  await expect(page.getByTestId('ruler-y')).toBeVisible();
  // Labeled ticks sit at canvas x = 0, 100, 200… (zoom × px from its left edge) at any zoom.
  for (const zoom of [1, 0.5, 2]) {
    await page.evaluate((z) => (window as unknown as { __sparca: { set(p: object): void } }).__sparca.set({ zoom: z }), zoom);
    await page.waitForTimeout(100);
    const c = await canvasBox(page);
    const r = (await page.getByTestId('ruler-x').boundingBox())!;
    // The first multiple of 100 that is on screen (the canvas's edge may be scrolled out of view).
    const x = Math.max(0, Math.ceil((r.x + 10 - c.x) / zoom / 100) * 100);
    expect(await tickAt(page, c.x + x * zoom)).toBe(true);
    expect(await tickAt(page, c.x + (x + 10) * zoom)).toBe(false); // nothing labeled in between
  }
  await toggleFromMenu(page);
  await expect(page.getByTestId('ruler-x')).toHaveCount(0);
  expect(await state(page, 's => s.rulers')).toBe(false);
  await page.reload();
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
  await expect(page.getByTestId('ruler-x')).toHaveCount(0);
  await toggleFromMenu(page);
  await expect(page.getByTestId('ruler-y')).toBeVisible();
});

test('the rulers can count from the canvas center (remembered)', async ({ page }) => {
  await page.getByRole('button', { name: '表示', exact: true }).click();
  await page.getByRole('menuitem', { name: /ルーラー・ガイド・グリッドの設定/ }).click();
  const prefs = page.getByRole('dialog', { name: '環境設定' });
  await prefs.getByRole('radio', { name: 'キャンバスの中心を 0' }).check();
  await prefs.getByRole('button', { name: '閉じる' }).click();
  expect(await state(page, 's => s.rulerOrigin')).toBe('center');
  await page.evaluate(() => (window as unknown as { __sparca: { set(p: object): void } }).__sparca.set({ zoom: 0.5 }));
  await page.waitForTimeout(100);
  const c = await canvasBox(page);
  // 0 is at the middle of the 800 px canvas (400 → 200 screen px at 50 %); labeled ticks every 100.
  expect(await tickAt(page, c.x + c.width / 2)).toBe(true);
  expect(await tickAt(page, c.x + c.width / 2 - 50)).toBe(true); // -100
  expect(await tickAt(page, c.x + c.width / 2 + 25)).toBe(false); // 50: not labeled at 50 %
  await page.reload();
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
  expect(await state(page, 's => s.rulerOrigin')).toBe('center');
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.getByRole('menuitem', { name: '環境設定…' }).click();
  await expect(prefs.getByRole('radio', { name: 'キャンバスの中心を 0' })).toBeChecked();
  await prefs.getByRole('radio', { name: 'キャンバスの左上を 0' }).check();
  expect(await state(page, 's => s.rulerOrigin')).toBe('corner');
});
