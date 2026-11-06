// Images shown at another size than their pixels are resampled with HANABI's own
// interpolation (bicubic unless the image's 画像サイズ chose another) when exported as a
// raster, instead of being scaled by the browser.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resample } from '../src/engine/resample';
import { decodePixels, disableNativePickers, makePng, waitImagesIdle } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
});

const SRC = 8;
const pixel = (x: number, y: number): [number, number, number, number] =>
  (x + y) % 2 ? [255, 255, 255, 255] : [(x * 37) % 256, (y * 53) % 256, ((x + y) * 29) % 256, 255];

async function exportPng(page: Page): Promise<Buffer> {
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByLabel('PNG', { exact: true }).check();
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  return readFileSync((await (await dl).path())!);
}

async function placeScaled(page: Page, size: number, method?: string, at = 100) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /画像を配置/ }).click();
  await (await chooser).setFiles({ name: 'src.png', mimeType: 'image/png', buffer: makePng(SRC, SRC, pixel) });
  await expect(page.locator('[data-testid=canvas] image')).toHaveCount(1);
  await page.evaluate(
    ({ size, method, at }) => {
      const ed = (window as unknown as { __sparca: { edit(label: string, fn: (d: any) => void): void } }).__sparca;
      ed.edit('test', (d) => {
        const o = d.layers.flatMap((l: any) => l.children).find((c: any) => c.type === 'image');
        o.box = { x: at, y: at, width: size + (at % 1), height: size + (at % 1), rotation: 0 };
        if (method) o.pipeline.resize = { width: 8, height: 8, method };
      });
    },
    { size, method, at },
  );
  await waitImagesIdle(page);
}

function expected(size: number, method: 'bicubic' | 'nearest') {
  const data = new Uint8ClampedArray(SRC * SRC * 4);
  for (let y = 0; y < SRC; y++) for (let x = 0; x < SRC; x++) data.set(pixel(x, y), (y * SRC + x) * 4);
  return resample({ width: SRC, height: SRC, data }, size, size, method);
}

for (const [label, size, method, at] of [
  ['enlarged (bicubic)', 37, undefined, 100],
  ['reduced (bicubic)', 5, undefined, 100],
  ['enlarged with the image size method (nearest)', 40, 'nearest', 100],
  // Off whole pixels (x = y = 100.4, 37.4 px wide): exported on whole pixels, not blended.
  ['at a fractional position (snapped to whole pixels)', 37, undefined, 100.4],
] as const) {
  test(`export resamples a scaled image with HANABI's interpolation: ${label}`, async ({ page }) => {
    await placeScaled(page, size, method, at);
    const o = Math.round(at);
    const png = await exportPng(page);
    const want = expected(size, method ?? 'bicubic');
    const points: [number, number][] = [];
    for (let y = 0; y < size; y += Math.max(1, Math.floor(size / 7))) for (let x = 0; x < size; x++) points.push([x, y]);
    const got = await decodePixels(page, png, 'image/png', points.map(([x, y]) => [o + x, o + y]));
    let worst = 0;
    points.forEach(([x, y], i) => {
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(got.px[i][k] - want.data[(y * size + x) * 4 + k]));
    });
    expect(worst).toBeLessThanOrEqual(2);
  });
}
