import { expect, test, type Locator, type Page } from '@playwright/test';
import { canvasBox, disableNativePickers, drag, makePng, placePng, processedPixels, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

/** 200×100 image with a 1px black / white checker everywhere (blurs to mid gray). */
const checkerPng = () => makePng(200, 100, (x, y) => ((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));

type Box = { x: number; y: number; width: number; height: number };

async function imageObject(page: Page) {
  return state<{ id: string; box: Box; pipeline: { localEdits: { mask: Record<string, unknown> }[] } }>(
    page,
    's => s.doc.layers.flatMap(l => l.children).find(o => o.type === "image")',
  );
}

async function setNumber(scope: Locator, label: string, value: string) {
  const input = scope.locator(`input[type="text"][aria-label="${label}"]`);
  await input.fill(value);
  await input.press('Enter');
}

/** Select image columns x0..x1 over the full height with the rect marquee. */
async function selectColumns(page: Page, img: { box: Box }, x0: number, x1: number) {
  const c = await canvasBox(page);
  await page.keyboard.press('m');
  await drag(page, { x: c.x + img.box.x + x0, y: c.y + img.box.y - 10 }, { x: c.x + img.box.x + x1, y: c.y + img.box.y + img.box.height + 10 });
}

/** Bounds of the marching ants in document coordinates. */
function antsBox(page: Page) {
  return page.evaluate(() => {
    const b = (document.querySelector('[data-testid="pixel-selection"] .ants-a') as SVGGraphicsElement).getBBox();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
}

async function blurSelection(page: Page) {
  await page.getByTestId('selection-panel').getByRole('button', { name: /選択範囲にぼかし/ }).click();
  const dialog = page.getByRole('dialog', { name: '選択範囲にぼかし' });
  await setNumber(dialog, 'ぼかし強度', '4');
  await dialog.getByRole('button', { name: '適用' }).click();
}

/** How far each pixel moved from the original checker toward the blurred gray (0 = untouched, 1 = fully blurred). */
async function blurAmount(page: Page, id: string, xs: number[]) {
  const out = await processedPixels(page, id, xs.map((x) => [x, 50] as [number, number]));
  return out.px.map((p, i) => {
    const orig = (xs[i] + 50) % 2 ? 255 : 0;
    return Math.min(1, Math.abs(p[0] - orig) / 127.5);
  });
}

test('selection tools have an edge setting that applies to new and current selections and is remembered', async ({ page }) => {
  const c = await canvasBox(page);
  // Not shown for other tools.
  await expect(page.getByTestId('selection-edge')).toHaveCount(0);
  await page.keyboard.press('m');
  const edge = page.getByTestId('selection-edge');
  await expect(edge.getByLabel('エッジ')).toHaveValue('antialias');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 200, y: c.y + 180 });
  await expect(page.getByTestId('pixel-selection')).toHaveAttribute('data-edge', 'antialias');
  // Changing the edge updates the current selection.
  await edge.getByLabel('エッジ').selectOption('feather');
  await setNumber(edge, 'ぼかしの幅', '20');
  expect(await state(page, 's => s.pixelSelection')).toMatchObject({ kind: 'rect', feather: 20 });
  await expect(page.getByTestId('pixel-selection')).toHaveAttribute('data-edge', 'feather');
  await edge.getByLabel('エッジ').selectOption('hard');
  expect(await state(page, 's => s.pixelSelection')).toMatchObject({ antialias: false });
  expect(await state(page, 's => s.pixelSelection.feather')).toBeUndefined();
  // New selections (lasso too) take the setting.
  await page.keyboard.press('l');
  await expect(page.getByTestId('selection-edge')).toBeVisible();
  await drag(page, { x: c.x + 300, y: c.y + 300 }, { x: c.x + 360, y: c.y + 340 });
  expect(await state(page, 's => s.pixelSelection')).toMatchObject({ kind: 'polygon', antialias: false });
  // Remembered by the browser.
  await page.reload();
  await page.getByRole('button', { name: '矩形選択ツール' }).click();
  await expect(page.getByTestId('selection-edge').getByLabel('エッジ')).toHaveValue('hard');
});

test('画像 → 選択範囲を拡張／縮小 moves the selection edge by a number of px', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('m');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 200, y: c.y + 160 });
  const before = await antsBox(page);

  await page.getByRole('button', { name: '画像', exact: true }).click();
  await page.getByRole('menuitem', { name: '選択範囲を拡張…' }).click();
  let dialog = page.getByRole('dialog', { name: '選択範囲を拡張' });
  await setNumber(dialog, '拡張する幅', '15');
  await dialog.getByRole('button', { name: 'OK' }).click();
  expect(await state(page, 's => s.pixelSelection.grow')).toBe(15);
  // The marching ants follow the grown edge.
  const grown = await antsBox(page);
  expect(grown.x).toBeCloseTo(before.x - 15, 0);
  expect(grown.width).toBeCloseTo(before.width + 30, 0);
  expect(grown.height).toBeCloseTo(before.height + 30, 0);

  // Contract from the properties panel; amounts add up.
  await page.getByTestId('selection-panel').getByRole('button', { name: '縮小…' }).click();
  dialog = page.getByRole('dialog', { name: '選択範囲を縮小' });
  await setNumber(dialog, '縮小する幅', '20');
  await dialog.getByRole('button', { name: 'OK' }).click();
  expect(await state(page, 's => s.pixelSelection.grow')).toBe(-5);
  const shrunk = await antsBox(page);
  expect(shrunk.x).toBeCloseTo(before.x + 5, 0);
  expect(shrunk.width).toBeCloseTo(before.width - 10, 0);
  // A new selection starts without grow.
  await drag(page, { x: c.x + 300, y: c.y + 300 }, { x: c.x + 360, y: c.y + 340 });
  expect(await state(page, 's => s.pixelSelection.grow')).toBeUndefined();
  // Without a selection the menu items are disabled.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '画像', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '選択範囲を拡張…' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: '選択範囲を縮小…' })).toBeDisabled();
});

test('selection blur follows the edge: hard, feathered and expanded selections', async ({ page }) => {
  await placePng(page, 'img.png', checkerPng());
  const img = await imageObject(page);
  expect(img.box.width).toBe(200);
  const edge = () => page.getByTestId('selection-edge').getByLabel('エッジ');

  // Hard edge: fully blurred right inside, untouched right outside.
  await page.keyboard.press('m');
  await edge().selectOption('hard');
  await selectColumns(page, img, 50, 150);
  await blurSelection(page);
  expect((await imageObject(page)).pipeline.localEdits[0].mask).toMatchObject({ antialias: false });
  let a = await blurAmount(page, img.id, [46, 48, 52, 54, 100]);
  expect(a[0]).toBeLessThan(0.05);
  expect(a[1]).toBeLessThan(0.05);
  expect(a[2]).toBeGreaterThan(0.9);
  expect(a[3]).toBeGreaterThan(0.9);
  await page.keyboard.press('Control+z');

  // Feathered edge: the effect fades in across the edge.
  await page.keyboard.press('m');
  await edge().selectOption('feather');
  await setNumber(page.getByTestId('selection-edge'), 'ぼかしの幅', '10');
  await blurSelection(page);
  expect((await imageObject(page)).pipeline.localEdits[0].mask).toMatchObject({ feather: 10 });
  a = await blurAmount(page, img.id, [30, 44, 50, 56, 70]);
  expect(a[0]).toBeLessThan(0.1);
  expect(a[1]).toBeGreaterThan(0.1);
  expect(a[1]).toBeLessThan(0.5);
  expect(a[2]).toBeGreaterThan(0.3);
  expect(a[2]).toBeLessThan(0.7);
  expect(a[3]).toBeGreaterThan(0.5);
  expect(a[4]).toBeGreaterThan(0.9);
  await page.keyboard.press('Control+z');

  // Expanded by 10 px (anti-aliased): the blur now starts at x = 40.
  await page.keyboard.press('m');
  await edge().selectOption('antialias');
  await page.getByTestId('selection-panel').getByRole('button', { name: '拡張…' }).click();
  const dialog = page.getByRole('dialog', { name: '選択範囲を拡張' });
  await setNumber(dialog, '拡張する幅', '10');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await blurSelection(page);
  expect((await imageObject(page)).pipeline.localEdits[0].mask).toMatchObject({ grow: 10 });
  a = await blurAmount(page, img.id, [36, 38, 42, 44]);
  expect(a[0]).toBeLessThan(0.05);
  expect(a[1]).toBeLessThan(0.05);
  expect(a[2]).toBeGreaterThan(0.9);
  expect(a[3]).toBeGreaterThan(0.9);
});
