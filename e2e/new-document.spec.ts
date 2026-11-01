// 新規ドキュメント: the size from a preset (1:1, 16:9, 4:3) or typed in.
import { expect, test } from '@playwright/test';
import { disableNativePickers, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
});

async function openDialog(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: '新規…' }).click();
  return page.getByRole('dialog', { name: '新規ドキュメント' });
}

test('a size preset fills in the width and height; typing a size shows 数値で指定', async ({ page }) => {
  const nd = await openDialog(page);
  const size = nd.getByLabel('サイズ');
  const w = nd.locator('input[aria-label="幅"]');
  const h = nd.locator('input[aria-label="高さ"]');
  await expect(size).toHaveValue('-1'); // 800 × 600 is not a preset
  await expect(size.locator('option')).toHaveText(['数値で指定', '1:1（1080 × 1080 px）', '16:9（1920 × 1080 px）', '4:3（1600 × 1200 px）']);
  await size.selectOption({ label: '4:3（1600 × 1200 px）' });
  await expect(w).toHaveValue('1600');
  await expect(h).toHaveValue('1200');
  await size.selectOption({ label: '1:1（1080 × 1080 px）' });
  await expect(w).toHaveValue('1080');
  await expect(h).toHaveValue('1080');
  // Changing a number leaves the preset.
  await h.fill('500');
  await h.press('Enter');
  await expect(size).toHaveValue('-1');
  await size.selectOption({ label: '16:9（1920 × 1080 px）' });
  await nd.getByRole('button', { name: '作成' }).click();
  expect(await state(page, 's => [s.doc.width, s.doc.height]')).toEqual([1920, 1080]);
});

test('typing the numbers of a preset selects it', async ({ page }) => {
  const nd = await openDialog(page);
  for (const [label, v] of [['幅', '1080'], ['高さ', '1080']]) {
    const i = nd.locator(`input[aria-label="${label}"]`);
    await i.fill(v);
    await i.press('Enter');
  }
  await expect(nd.getByLabel('サイズ')).toHaveValue('0');
});
