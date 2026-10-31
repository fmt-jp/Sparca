// 画像の書き出し: the file name is chosen in one place — the browser's save dialog where
// there is one, the dialog's own field where the file is downloaded instead.
import { expect, test } from '@playwright/test';
import { disableNativePickers } from './helpers';

test('with the browser save dialog, the export dialog has no name field and suggests the name', async ({ page }) => {
  // A stand-in for Chrome's save dialog that records what was asked and "saves" to memory.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__picked = [];
    w.showSaveFilePicker = async (o: { suggestedName: string; types: { accept: Record<string, string[]> }[] }) => {
      (w.__picked as unknown[]).push({ suggestedName: o.suggestedName, accept: o.types[0].accept });
      return {
        name: 'えらんだ名前.jpg',
        getFile: async () => new File([], 'x'),
        createWritable: async () => ({ write: async (b: Blob) => void ((w.__size as number) = b.size), close: async () => undefined }),
      };
    };
  });
  await page.goto('/');
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await expect(dialog.getByLabel('ファイル名')).toHaveCount(0);
  await expect(dialog).toContainText('保存先とファイル名を選ぶ画面');
  await dialog.getByLabel('JPEG', { exact: true }).check();
  await dialog.getByRole('button', { name: '書き出し' }).click();
  await expect(dialog).toHaveCount(0);
  const picked = await page.evaluate(() => (window as unknown as { __picked: unknown[] }).__picked);
  expect(picked).toEqual([{ suggestedName: 'untitled.jpg', accept: { 'image/jpeg': ['.jpg'] } }]);
  expect(await page.evaluate(() => (window as unknown as { __size: number }).__size)).toBeGreaterThan(0);
  await expect(page.locator('.notice')).toContainText('えらんだ名前.jpg を書き出しました');
});

test('cancelling the save dialog keeps the export dialog open', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).showSaveFilePicker = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
  });
  await page.goto('/');
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByRole('button', { name: '書き出し' }).click();
  await expect(dialog).toBeVisible();
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

test('without it (download), the name is entered in the export dialog', async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByLabel('ファイル名').fill('hanabi');
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  expect((await dl).suggestedFilename()).toBe('hanabi.png');
});
