import { expect, test, type Locator, type Page } from '@playwright/test';
import { canvasBox, disableNativePickers, drag, makePng, placePng, processedPixels, state, waitImagesIdle } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

/** 200×100 image: left half dark gray, right half light gray, with a 1px checker in the top-left 20×20. */
const testPng = () =>
  makePng(200, 100, (x, y) => {
    if (x < 20 && y < 20) return (x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255];
    return x < 100 ? [60, 70, 80, 255] : [180, 170, 160, 255];
  });

async function imageObject(page: Page) {
  return state<{ id: string; box: { x: number; y: number; width: number; height: number }; pipeline: Record<string, unknown> }>(
    page,
    's => s.doc.layers.flatMap(l => l.children).find(o => o.type === "image")',
  );
}

async function setNumber(page: Page, label: string, value: string, scope?: Locator) {
  const input = (scope ?? page.getByRole('region', { name: 'プロパティ' })).locator(`input[type="text"][aria-label="${label}"]`);
  await input.fill(value);
  await input.press('Enter');
}

test.afterEach(async ({ page }) => {
  // No unexpected error notices during the test.
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

test('manual color adjustments change the rendered pixels and can be undone', async ({ page }) => {
  await placePng(page, 'img.png', testPng());
  const img = await imageObject(page);
  const originalHref = await page.locator('[data-testid=canvas] image').getAttribute('href');
  const before = await processedPixels(page, img.id, [[50, 50]]);
  await setNumber(page, '明るさ', '40');
  await setNumber(page, '彩度', '-100');
  await waitImagesIdle(page);
  const after = await processedPixels(page, img.id, [[50, 50], [150, 50]]);
  expect(after.px[0][0]).toBeGreaterThan(before.px[0][0] + 20);
  // Saturation −100 → gray.
  const [r, g, b] = after.px[1];
  expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(1);
  // The canvas shows the processed raster, not the original asset.
  await expect.poll(() => page.locator('[data-testid=canvas] image').getAttribute('href')).not.toBe(originalHref);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect((await imageObject(page)).pipeline.adjust).toMatchObject({ brightness: 0, saturation: 0 });
});

test('auto color analyzes the image and stores explicit parameters', async ({ page }) => {
  await placePng(page, 'img.png', makePng(64, 64, (x, y) => [90 + (x % 40), 90 + (y % 40), 150, 255]));
  await page.getByRole('button', { name: '自動カラー調整' }).click();
  await expect.poll(async () => (await imageObject(page)).pipeline.adjust).toMatchObject({ auto: { black: expect.any(Array) } });
  const auto = ((await imageObject(page)).pipeline.adjust as { auto: { black: number[]; white: number[] } }).auto;
  expect(auto.black[0]).toBeGreaterThan(80);
  expect(auto.white[0]).toBeLessThan(140);
});

test('image size: pixel and percent modes with interpolation choice', async ({ page }) => {
  await placePng(page, 'img.png', testPng());
  await page.getByRole('button', { name: '画像サイズ…' }).click();
  const dialog = page.getByRole('dialog', { name: '画像サイズ' });
  await expect(dialog.getByLabel('補間方式')).toHaveValue('bicubic');
  await setNumber(page, '幅', '400', dialog);
  await expect(dialog.getByTestId('result-size')).toContainText('400 × 200 px');
  // Aspect unlocked: height independent.
  await dialog.getByLabel('縦横比を固定').uncheck();
  await setNumber(page, '高さ', '50', dialog);
  await expect(dialog.getByTestId('result-size')).toContainText('400 × 50 px');
  await dialog.getByLabel('縦横比を固定').check();
  // Percent mode
  await dialog.getByLabel('比率指定').check();
  await setNumber(page, '拡大・縮小率', '300', dialog);
  await expect(dialog.getByTestId('result-size')).toContainText('600 × 300 px');
  await dialog.getByLabel('補間方式').selectOption('nearest');
  await expect(dialog.getByTestId('resize-after')).toHaveAttribute('style', /blob:/, { timeout: 15000 });
  await dialog.getByRole('button', { name: '適用' }).click();
  const img = await imageObject(page);
  expect(img.pipeline.resize).toEqual({ width: 600, height: 300, method: 'nearest' });
  expect(img.box).toMatchObject({ width: 600, height: 300 });
  // Nearest neighbor 3× keeps the 1px checker crisp (pure black/white 3×3 blocks).
  const out = await processedPixels(page, img.id, [[0, 0], [3, 0], [4, 1]]);
  expect([out.width, out.height]).toEqual([600, 300]);
  expect(out.px[0].slice(0, 3)).toEqual([0, 0, 0]);
  expect(out.px[1].slice(0, 3)).toEqual([255, 255, 255]);
  expect(out.px[2].slice(0, 3)).toEqual([255, 255, 255]);
});

test('image size rejects invalid and huge sizes', async ({ page }) => {
  await placePng(page, 'img.png', testPng());
  await page.getByRole('button', { name: '画像サイズ…' }).click();
  const dialog = page.getByRole('dialog', { name: '画像サイズ' });
  await dialog.getByLabel('縦横比を固定').uncheck();
  await setNumber(page, '幅', '16384', dialog);
  await setNumber(page, '高さ', '16384', dialog);
  await expect(dialog.getByTestId('result-size')).toContainText('上限');
  await expect(dialog.getByRole('button', { name: '適用' })).toBeDisabled();
  await dialog.locator('input[aria-label="幅"]').fill('abc');
  await dialog.locator('input[aria-label="幅"]').press('Enter');
  await expect(page.locator('.notice.error')).toContainText('数値');
  await page.locator('.notice.error').click();
});

test('canvas size with 9-point anchor moves content without scaling it', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 0, y: c.y + 0 }, { x: c.x + 100, y: c.y + 50 });
  await page.getByRole('button', { name: '変更' }).click();
  await page.getByRole('menuitem', { name: /キャンバスサイズ/ }).click();
  const dialog = page.getByRole('dialog', { name: 'キャンバスサイズ' });
  await setNumber(page, '幅', '1000', dialog);
  await setNumber(page, '高さ', '500', dialog);
  await dialog.getByRole('radio', { name: '右下' }).click();
  await expect(dialog).toContainText('左に 200px 余白を追加');
  await expect(dialog).toContainText('上に 100px 切り落とし');
  await dialog.getByRole('button', { name: '適用' }).click();
  const doc = await state<{ width: number; height: number; layers: { children: { box: { x: number; y: number; width: number } }[] }[] }>(page, 's => s.doc');
  expect([doc.width, doc.height]).toEqual([1000, 500]);
  expect(doc.layers[0].children[0].box).toMatchObject({ x: 200, y: -100, width: 100 });
});

test('crop tool: document crop and image-only crop are distinct', async ({ page }) => {
  await placePng(page, 'img.png', testPng());
  let img = await imageObject(page);
  const c = await canvasBox(page);
  // Image crop (image is selected → target defaults to the image).
  await page.keyboard.press('c');
  await expect(page.getByTestId('crop-panel').getByLabel('選択中の画像のみ')).toBeChecked();
  await drag(page, { x: c.x + img.box.x + 100, y: c.y + img.box.y }, { x: c.x + img.box.x + 200, y: c.y + img.box.y + 50 });
  await page.keyboard.press('Enter');
  img = await imageObject(page);
  expect(img.pipeline.crop).toEqual({ x: 100, y: 0, width: 100, height: 50 });
  expect(await state<number[]>(page, 's => [s.doc.width, s.doc.height]')).toEqual([800, 600]);
  const px = await processedPixels(page, img.id, [[10, 10]]);
  expect([px.width, px.height]).toEqual([100, 50]);
  expect(px.px[0].slice(0, 3)).toEqual([180, 170, 160]);
  // Document crop.
  await page.getByTestId('crop-panel').getByLabel('キャンバス全体').check();
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 500, y: c.y + 400 });
  await page.getByRole('button', { name: '確定（Enter）' }).click();
  expect(await state<number[]>(page, 's => [s.doc.width, s.doc.height]')).toEqual([400, 300]);
  const moved = await imageObject(page);
  expect(moved.box.x).toBeCloseTo(img.box.x - 100);
  expect(moved.pipeline.crop).toEqual(img.pipeline.crop);
  // Undo restores both steps.
  await page.keyboard.press('Control+z');
  expect(await state<number[]>(page, 's => [s.doc.width, s.doc.height]')).toEqual([800, 600]);
  await page.keyboard.press('Control+z');
  expect((await imageObject(page)).pipeline.crop).toBeNull();
});

test('range selection + blur only affects the selected area', async ({ page }) => {
  await placePng(page, 'img.png', testPng());
  const img = await imageObject(page);
  const c = await canvasBox(page);
  // Select the left-top checker region (image pixels 0..40 × 0..40).
  await page.keyboard.press('m');
  await drag(page, { x: c.x + img.box.x - 5, y: c.y + img.box.y - 5 }, { x: c.x + img.box.x + 40, y: c.y + img.box.y + 40 });
  await expect(page.getByTestId('pixel-selection')).toBeVisible();
  await page.getByTestId('selection-panel').getByRole('button', { name: /選択範囲にぼかし/ }).click();
  const dialog = page.getByRole('dialog', { name: '選択範囲にぼかし' });
  await setNumber(page, 'ぼかし強度', '4', dialog);
  await dialog.getByRole('button', { name: '適用' }).click();
  const after = await imageObject(page);
  expect((after.pipeline.localEdits as unknown[]).length).toBe(1);
  const out = await processedPixels(page, img.id, [[10, 10], [11, 10], [150, 50], [60, 80]]);
  // Inside: checker blurred to mid gray.
  expect(Math.abs(out.px[0][0] - 128)).toBeLessThan(40);
  expect(Math.abs(out.px[0][0] - out.px[1][0])).toBeLessThan(20);
  // Outside: untouched.
  expect(out.px[2].slice(0, 3)).toEqual([180, 170, 160]);
  expect(out.px[3].slice(0, 3)).toEqual([60, 70, 80]);
  // Lasso and polygon selections also produce selections.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pixel-selection')).toHaveCount(0);
  await page.keyboard.press('l');
  await drag(page, { x: c.x + 300, y: c.y + 300 }, { x: c.x + 360, y: c.y + 340 });
  expect(await state<string>(page, 's => s.pixelSelection?.kind')).toBe('polygon');
  await page.keyboard.press('l');
  expect(await state<string>(page, 's => s.tool')).toBe('polygon-lasso');
  for (const [x, y] of [[300, 300], [400, 300], [350, 380]]) await page.mouse.click(c.x + x, c.y + y);
  await page.keyboard.press('Enter');
  expect(await state<number>(page, 's => s.pixelSelection?.points.length')).toBe(3);
});

test('whole-image blur and before/after comparison', async ({ page }) => {
  await placePng(page, 'img.png', testPng());
  const img = await imageObject(page);
  await setNumber(page, 'ぼかし', '5');
  await waitImagesIdle(page);
  const out = await processedPixels(page, img.id, [[100, 50]]);
  expect(out.px[0][0]).toBeGreaterThan(70);
  expect(out.px[0][0]).toBeLessThan(170);
  const compare = page.getByRole('button', { name: /加工前と比較/ });
  await compare.hover();
  await page.mouse.down();
  expect(await state<string | null>(page, 's => s.compareImageId')).toBe(img.id);
  await page.mouse.up();
  expect(await state<string | null>(page, 's => s.compareImageId')).toBeNull();
});
