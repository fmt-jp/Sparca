// キャンバスのプロパティ「内容に合わせる」 and 変更 → キャンバスを内容に合わせる.
import { expect, test } from '@playwright/test';
import { canvasBox, disableNativePickers, drag, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
});

test('the canvas properties fit the canvas to the drawn shapes, in one undo step', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 150 }, { x: c.x + 200, y: c.y + 250 });
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 300, y: c.y + 200 }, { x: c.x + 450, y: c.y + 300 });
  await page.keyboard.press('Escape'); // nothing selected: the canvas properties show
  const props = page.getByRole('region', { name: 'プロパティ' });
  await props.getByRole('button', { name: '内容に合わせる' }).click();
  expect(await state(page, 's => [s.doc.width, s.doc.height]')).toEqual([350, 150]);
  expect(await state(page, 's => s.doc.layers[0].children.map(o => [o.box.x, o.box.y])')).toEqual([
    [0, 0],
    [200, 50],
  ]);
  await expect(props).toContainText('キャンバス 350 × 150 px');
  await page.keyboard.press('Control+z');
  expect(await state(page, 's => [s.doc.width, s.doc.height]')).toEqual([800, 600]);
  // Also from the 変更 menu.
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await page.getByRole('menuitem', { name: 'キャンバスを内容に合わせる' }).click();
  expect(await state(page, 's => [s.doc.width, s.doc.height]')).toEqual([350, 150]);
});

test('with nothing on the canvas it says so and changes nothing', async ({ page }) => {
  await page.getByRole('region', { name: 'プロパティ' }).getByRole('button', { name: '内容に合わせる' }).click();
  await expect(page.locator('.notice.error')).toContainText('合わせる画像や図形がありません');
  expect(await state(page, 's => [s.doc.width, s.doc.height]')).toEqual([800, 600]);
});
