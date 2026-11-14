// レタッチ (2026-11-11): コピースタンプ, ぼかし／シャープブラシ, 覆い焼き／焼き込み — strokes kept
// on the selected image as edits.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canvasBox, decodePixels, disableNativePickers, makePng, state, waitImagesIdle } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
});

const props = (page: Page) => page.getByRole('region', { name: 'プロパティ' });

async function exportPng(page: Page, points: [number, number][]) {
  await waitImagesIdle(page);
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByLabel('PNG', { exact: true }).check();
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  return (await decodePixels(page, readFileSync((await (await dl).path())!), 'image/png', points)).px;
}

async function setNum(page: Page, label: string, v: string) {
  const i = props(page).locator(`input[aria-label="${label}"]`);
  await i.fill(v);
  await i.press('Enter');
}

/** A 400×200 image at (200,200)–(600,400): left half red, right half blue (or one gray). */
async function placeImage(page: Page, gray?: number) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /画像を配置/ }).click();
  const png = makePng(400, 200, (x) => (gray !== undefined ? [gray, gray, gray, 255] : x < 200 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
  await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('[data-testid=canvas] image')).toHaveCount(1);
  await page.evaluate(() => (window as unknown as { __sparca: { set(p: object): void } }).__sparca.set({ zoom: 1 }));
  await page.waitForTimeout(100);
  const ws = (await page.locator('.overlay').boundingBox())!;
  return (x: number, y: number) => ({ x: ws.x + x, y: ws.y + y });
}

const edits = (page: Page) => state<{ tool: string; offset?: { x: number; y: number } }[]>(page, 's => s.doc.layers[0].children[0].pipeline.localEdits');

test('コピースタンプ: Alt+click sets the source; strokes copy from it, keeping the offset', async ({ page }) => {
  const at = await placeImage(page);
  await page.keyboard.press('s');
  await expect(page.locator('.toolbar [data-tool="clone"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(props(page).getByTestId('clone-status')).toContainText('未指定');
  await setNum(page, 'コピースタンプのサイズ', '40');
  await setNum(page, 'コピースタンプの硬さ', '100');
  // Source: in the blue half (500, 300).
  const src = at(500, 300);
  await page.keyboard.down('Alt');
  await page.mouse.click(src.x, src.y);
  await page.keyboard.up('Alt');
  await expect(page.getByTestId('clone-source')).toBeVisible();
  // Paint in the red half from (300, 300) to the right.
  let a = at(300, 300);
  let b = at(340, 300);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await edits(page)).length).toBe(1);
  await expect(props(page).getByTestId('clone-status')).toContainText('同じずれ');
  // A second stroke elsewhere keeps the same offset (+200 px).
  a = at(250, 250);
  b = at(260, 250);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await edits(page)).length).toBe(2);
  const [e1, e2] = await edits(page);
  expect(e1.offset!.x).toBeCloseTo(0.5, 3); // 200 px of 400
  expect(e2.offset).toEqual(e1.offset);
  const px = await exportPng(page, [[320, 300], [300, 360], [255, 250], [500, 300]]);
  expect(px[0]).toEqual([0, 0, 255, 255]); // red replaced by the blue 200 px to the right
  expect(px[1]).toEqual([255, 0, 0, 255]); // off the strokes
  expect(px[2]).toEqual([0, 0, 255, 255]);
  expect(px[3]).toEqual([0, 0, 255, 255]); // the source is unchanged
});

test('without a source the stamp asks for one; retouch tools need a selected image', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('o');
  await expect(page.locator('.toolbar [data-tool="blur"]')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(c.x + 100, c.y + 100);
  await page.mouse.down();
  await page.mouse.move(c.x + 200, c.y + 100, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('.notice.error')).toContainText('ぼかしブラシで加工する画像を選択してください');
  await page.locator('.notice.error').click();
  await page.keyboard.press('s');
  await page.mouse.click(c.x + 150, c.y + 150);
  await expect(page.locator('.notice.error')).toContainText('コピー元を Alt+クリックで指定');
  await page.locator('.notice.error').click();
  expect(await state(page, 's => s.doc.layers[0].children.length')).toBe(0);
});

test('覆い焼き lightens, 焼き込み darkens (O cycles through the retouch brushes)', async ({ page }) => {
  const at = await placeImage(page, 128);
  // O: ぼかし → シャープ → 覆い焼き.
  for (let i = 0; i < 3; i++) await page.keyboard.press('o');
  await expect(page.locator('.toolbar [data-tool="dodge"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(props(page).getByRole('radio', { name: '中間調' })).toBeChecked();
  await setNum(page, '覆い焼きのサイズ', '40');
  await setNum(page, '覆い焼きの硬さ', '100');
  await setNum(page, '覆い焼きの強さ', '100');
  let a = at(250, 260);
  let b = at(350, 260);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('o'); // 焼き込み
  await expect(page.locator('.toolbar [data-tool="burn"]')).toHaveAttribute('aria-pressed', 'true');
  await setNum(page, '焼き込みのサイズ', '40');
  await setNum(page, '焼き込みの硬さ', '100');
  await setNum(page, '焼き込みの強さ', '100');
  a = at(250, 340);
  b = at(350, 340);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await edits(page)).map((e) => e.tool)).toEqual(['dodge', 'burn']);
  const px = await exportPng(page, [[300, 260], [300, 340], [300, 300]]);
  expect(px[0][0]).toBeGreaterThan(170);
  expect(px[1][0]).toBeLessThan(90);
  expect(px[2][0]).toBe(128);
});

test('赤目除去: clicking a red eye makes it dark gray, the skin around stays (J)', async ({ page }) => {
  // Skin-colored image with a red disk (the pupil) at its center (400, 300).
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /画像を配置/ }).click();
  const png = makePng(200, 200, (x, y) => (Math.hypot(x - 100, y - 100) < 15 ? [200, 25, 35, 255] : [225, 175, 145, 255]));
  await (await chooser).setFiles({ name: 'face.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('[data-testid=canvas] image')).toHaveCount(1);
  await page.evaluate(() => (window as unknown as { __sparca: { set(p: object): void } }).__sparca.set({ zoom: 1 }));
  await page.waitForTimeout(100);
  const ws = (await page.locator('.overlay').boundingBox())!;
  await page.keyboard.press('j');
  await expect(page.locator('.toolbar [data-tool="redeye"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(props(page).getByTestId('stroke-tool-panel')).toContainText('瞳の大きさ');
  await setNum(page, '赤目除去のサイズ', '40');
  await page.mouse.click(ws.x + 400, ws.y + 300);
  await expect.poll(async () => (await edits(page)).map((e) => e.tool)).toEqual(['redeye']);
  const px = await exportPng(page, [[400, 300], [425, 300], [470, 300]]);
  expect(px[0][0]).toBeLessThan(80); // the pupil: no longer red
  expect(Math.abs(px[0][0] - px[0][1])).toBeLessThan(25);
  expect(px[1]).toEqual([225, 175, 145, 255]); // skin inside the circle: unchanged
  expect(px[2]).toEqual([225, 175, 145, 255]);
});
