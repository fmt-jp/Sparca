import { expect, test, type Page } from '@playwright/test';
import { canvasBox, disableNativePickers, drag, makeBmp, makePng, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

async function openFiles(page: Page, files: { name: string; buffer: Buffer }[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /開く/ }).click();
  await (await chooser).setFiles(files.map((f) => ({ ...f, mimeType: '' })));
}

const tabNames = (page: Page) => page.getByRole('tab').locator('.tab-name').allTextContents();
const docSize = (page: Page) => state<number[]>(page, 's => [s.doc.width, s.doc.height]');

test('opens several files at once, each in its own tab, and switches between them', async ({ page }) => {
  await openFiles(page, [
    { name: 'red.png', buffer: makePng(30, 20, () => [255, 0, 0, 255]) },
    { name: 'green.bmp', buffer: makeBmp(40, 10, () => [0, 255, 0]) },
  ]);
  // The untouched untitled document was replaced, not kept as a third tab.
  await expect.poll(() => tabNames(page)).toEqual(['red', 'green']);
  await expect(page.getByRole('tab', { selected: true })).toContainText('green');
  expect(await docSize(page)).toEqual([40, 10]);
  await page.getByRole('tab', { name: /red/ }).click();
  await expect(page.getByRole('tab', { selected: true })).toContainText('red');
  expect(await docSize(page)).toEqual([30, 20]);
});

test('each tab keeps its own document, undo history, selection and zoom', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 50, y: c.y + 50 }, { x: c.x + 150, y: c.y + 150 });
  await page.getByRole('button', { name: 'ズームアウト', exact: true }).click();
  await expect(page.getByRole('tab', { selected: true })).toContainText('●');

  // A new document opens in a second tab; the first one is kept.
  await page.getByRole('button', { name: '新規ドキュメント' }).click();
  const nd = page.getByRole('dialog', { name: '新規ドキュメント' });
  const w = nd.locator('input[aria-label="幅"]');
  await w.fill('300');
  await w.press('Enter');
  await nd.getByRole('button', { name: '作成' }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  expect(await state<unknown>(page, 's => [s.doc.width, s.doc.layers[0].children.length, s.zoom, s.selection.length]')).toEqual([300, 0, 1, 0]);
  await page.keyboard.press('Control+z'); // nothing to undo here
  expect(await state<number>(page, 's => s.doc.layers[0].children.length')).toBe(0);

  await page.getByRole('tab').first().click();
  expect(await state<unknown>(page, 's => [s.doc.width, s.doc.layers[0].children.length, s.zoom, s.selection.length]')).toEqual([800, 1, 0.667, 1]);
  await page.keyboard.press('Control+z');
  expect(await state<number>(page, 's => s.doc.layers[0].children.length')).toBe(0);
  await expect(page.getByRole('tab').first()).not.toContainText('●');
});

test('closing a tab with unsaved changes asks first; closing the last tab leaves an empty document', async ({ page }) => {
  await openFiles(page, [
    { name: 'a.png', buffer: makePng(10, 10, () => [0, 0, 0, 255]) },
    { name: 'b.png', buffer: makePng(12, 12, () => [0, 0, 0, 255]) },
  ]);
  await expect.poll(() => tabNames(page)).toEqual(['a', 'b']);
  await page.keyboard.press('Delete'); // edit b (its image is selected)
  let message = '';
  page.once('dialog', (d) => {
    message = d.message();
    void d.dismiss();
  });
  await page.getByRole('button', { name: '「b」を閉じる' }).click();
  expect(message).toContain('保存していない変更');
  expect(await tabNames(page)).toEqual(['a', 'b']); // cancelled
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: '「b」を閉じる' }).click();
  expect(await tabNames(page)).toEqual(['a']);
  expect(await docSize(page)).toEqual([10, 10]);
  await page.getByRole('button', { name: '「a」を閉じる' }).click(); // unchanged: no question
  expect(await tabNames(page)).toEqual(['名称未設定']);
  expect(await docSize(page)).toEqual([800, 600]);
});

test('save applies to the active tab only', async ({ page }) => {
  await openFiles(page, [
    { name: 'one.png', buffer: makePng(10, 10, () => [0, 0, 0, 255]) },
    { name: 'two.png', buffer: makePng(10, 10, () => [0, 0, 0, 255]) },
  ]);
  await expect.poll(() => tabNames(page)).toEqual(['one', 'two']);
  await page.keyboard.press('Delete');
  await page.getByRole('tab').first().click();
  await page.keyboard.press('Delete');
  const dl = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  expect((await dl).suggestedFilename()).toBe('one.sparca');
  await expect(page.getByRole('tab').first()).not.toContainText('●');
  await expect(page.getByRole('tab').nth(1)).toContainText('●');
});
