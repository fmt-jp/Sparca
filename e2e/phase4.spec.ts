import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canvasBox, decodePixels, disableNativePickers, drag, makePng, placePng } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

async function exportAs(page: Page, format: 'PNG' | 'JPEG' | 'WebP', quality?: string) {
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await expect(dialog).toContainText('レイヤー構造や編集情報');
  await dialog.getByLabel(format, { exact: true }).check();
  if (quality) {
    const q = dialog.locator('input[type="text"][aria-label="品質"]');
    await q.fill(quality);
    await q.press('Enter');
  }
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  const d = await dl;
  return { name: d.suggestedFilename(), bytes: readFileSync((await d.path())!) };
}

/** Transparent 400×300 document with a red square, a darkened image, a shadowed shape and text. */
async function buildScene(page: Page) {
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: '新規…' }).click();
  const nd = page.getByRole('dialog', { name: '新規ドキュメント' });
  for (const [label, v] of [['幅', '400'], ['高さ', '300']]) {
    const i = nd.locator(`input[aria-label="${label}"]`);
    await i.fill(v);
    await i.press('Enter');
  }
  await nd.getByLabel('透明な背景').check();
  await nd.getByRole('button', { name: '作成' }).click();
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 10, y: c.y + 10 }, { x: c.x + 60, y: c.y + 60 });
  // Red fill via the color input.
  await page.getByRole('region', { name: 'プロパティ' }).getByLabel('塗り', { exact: true }).fill('#ff0000');
  // Shadowed shape.
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 10 }, { x: c.x + 150, y: c.y + 60 });
  await page.getByLabel('ドロップシャドウ', { exact: true }).check();
  const dist = page.locator('input[type="text"][aria-label="影の距離"]');
  await dist.fill('20');
  await dist.press('Enter');
  const blur = page.locator('input[type="text"][aria-label="影のぼかし"]');
  await blur.fill('0');
  await blur.press('Enter');
  // Image 100×100 gray(100) with brightness +50.
  await placePng(page, 'g.png', makePng(100, 100, () => [100, 100, 100, 255]));
  await page.keyboard.press('v');
  const img = page.getByRole('region', { name: 'プロパティ' });
  for (const [label, v] of [['X', '250'], ['Y', '150'], ['明るさ', '50']]) {
    const i = img.locator(`input[type="text"][aria-label="${label}"]`);
    await i.fill(v);
    await i.press('Enter');
  }
}

test('PNG export keeps transparency and includes vector, raster edits and effects', async ({ page }) => {
  await buildScene(page);
  const out = await exportAs(page, 'PNG');
  expect(out.name).toBe('untitled.png');
  const px = await decodePixels(page, out.bytes, 'image/png', [[5, 5], [35, 35], [300, 200], [125 + 14, 35 + 14], [200, 280]]);
  expect([px.width, px.height]).toEqual([400, 300]);
  expect(px.px[0][3]).toBe(0); // transparent background
  expect(px.px[1]).toEqual([255, 0, 0, 255]); // red square
  expect(px.px[2][0]).toBeGreaterThan(140); // brightened image (100 + 64)
  expect(px.px[2][0]).toBeLessThan(190);
  expect(px.px[3][3]).toBeGreaterThan(50); // drop shadow offset down-right
  expect(px.px[4][3]).toBe(0);
});

test('JPEG export flattens transparency onto the chosen color and honors quality', async ({ page }) => {
  await buildScene(page);
  const hi = await exportAs(page, 'JPEG', '95');
  expect(hi.name).toBe('untitled.jpg');
  const px = await decodePixels(page, hi.bytes, 'image/jpeg', [[5, 5], [35, 35]]);
  expect(px.px[0].slice(0, 3).every((v) => v > 245)).toBe(true); // white instead of transparent
  expect(px.px[1][0]).toBeGreaterThan(230);
  expect(px.px[1][1]).toBeLessThan(30);
  const lo = await exportAs(page, 'JPEG', '10');
  expect(lo.bytes.length).toBeLessThan(hi.bytes.length);
});

test('WebP export with quality and alpha', async ({ page }) => {
  await buildScene(page);
  const out = await exportAs(page, 'WebP', '80');
  expect(out.name).toBe('untitled.webp');
  expect(out.bytes.subarray(8, 12).toString()).toBe('WEBP');
  const px = await decodePixels(page, out.bytes, 'image/webp', [[5, 5], [35, 35]]);
  expect(px.px[0][3]).toBe(0);
  expect(px.px[1][0]).toBeGreaterThan(220);
});

test('export failure is reported and leaves the document unchanged', async ({ page }) => {
  await buildScene(page);
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(null);
    };
  });
  const before = await page.evaluate(() => JSON.stringify((window as never as { __sparca: { getState(): { doc: unknown } } }).__sparca.getState().doc));
  await page.keyboard.press('Control+Shift+E');
  await page.getByRole('dialog').getByRole('button', { name: '書き出し' }).click();
  await expect(page.locator('.notice.error')).toContainText('PNG への変換に失敗しました');
  await expect(page.getByRole('dialog')).toBeVisible();
  const after = await page.evaluate(() => JSON.stringify((window as never as { __sparca: { getState(): { doc: unknown } } }).__sparca.getState().doc));
  expect(after).toBe(before);
});
