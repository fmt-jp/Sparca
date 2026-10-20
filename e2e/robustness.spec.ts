import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { disableNativePickers, makePng, placePng, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

test('an image copied into a new document can be saved and reopened there', async ({ page }) => {
  await placePng(page, 'blue.png', makePng(20, 20, () => [0, 0, 255, 255]));
  await page.keyboard.press('v');
  await page.keyboard.press('Control+c');
  page.once('dialog', (d) => d.accept()); // discard unsaved changes
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: '新規…' }).click();
  await page.getByRole('dialog', { name: '新規ドキュメント' }).getByRole('button', { name: '作成' }).click();
  await page.keyboard.press('Control+v');
  await expect(page.locator('[data-testid=canvas] image')).toHaveCount(1);
  const dl = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const path = await (await dl).path();
  await expect(page.locator('.notice.error')).toHaveCount(0);
  await page.reload();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /開く/ }).click();
  await (await chooser).setFiles({ name: 'p.sparca', mimeType: 'application/octet-stream', buffer: readFileSync(path!) });
  await expect(page.locator('[data-testid=canvas] image')).toHaveCount(1);
});

test('an image-processing failure is reported to the user', async ({ page }) => {
  await placePng(page, 'x.png', makePng(10, 10, () => [0, 0, 0, 255]));
  // Corrupt the pipeline directly: an output size the engine cannot allocate.
  await page.evaluate(() => {
    const ed = (window as never as { __sparca: { edit(l: string, r: (d: { layers: { children: { pipeline: { resize: unknown } }[] }[] }) => void): void } }).__sparca;
    ed.edit('test', (d) => {
      d.layers[0].children[0].pipeline.resize = { width: 10, height: 1e9, method: 'bicubic' };
    });
  });
  await expect(page.locator('.notice.error')).toContainText('画像処理に失敗しました');
});

test('opening a corrupt project shows the reason and keeps the current document', async ({ page }) => {
  await placePng(page, 'x.png', makePng(4, 4, () => [0, 0, 0, 255]));
  await page.keyboard.press('Control+s'); // save so no confirmation is needed
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /開く/ }).click();
  await (await chooser).setFiles({ name: 'bad.sparca', mimeType: 'application/octet-stream', buffer: Buffer.from('garbage') });
  await expect(page.locator('.notice.error')).toContainText('ZIP 形式ではない');
  expect(await state<number>(page, 's => s.doc.layers[0].children.length')).toBe(1);
});
