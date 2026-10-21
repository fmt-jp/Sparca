import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canvasBox, decodePixels, disableNativePickers, drag, setColor, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

type G = { kind: string; start: { x: number; y: number }; end: { x: number; y: number }; stops: { offset: number; color: string; opacity: number }[] };
const fill = (page: Page) => state<G | string | null>(page, 's => s.doc.layers[0].children[0].fill');
const props = (page: Page) => page.getByRole('region', { name: 'プロパティ' });

async function exportPng(page: Page) {
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByLabel('PNG', { exact: true }).check();
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  return readFileSync((await (await dl).path())!);
}

/** Red-to-blue rectangle at (100,100)–(400,300) on the white 800×600 canvas. */
async function gradientRect(page: Page, kind: string) {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 400, y: c.y + 300 });
  await props(page).getByLabel('塗りの種類').selectOption(kind);
  // Color 1 red, color 2 blue.
  await props(page).getByRole('button', { name: /^塗りの色1/ }).click();
  await setColor(page, props(page), 'グラデーションの色', '#ff0000');
  await props(page).getByRole('button', { name: /^塗りの色2/ }).click();
  await setColor(page, props(page), 'グラデーションの色', '#0000ff');
  return c;
}

const isReddish = (p: number[]) => p[0] > 180 && p[2] < 80;
const isBluish = (p: number[]) => p[2] > 180 && p[0] < 80;

test('linear gradient: rendered and exported from start to end; handles move it', async ({ page }) => {
  const c = await gradientRect(page, 'linear');
  const g = (await fill(page)) as G;
  expect(g.kind).toBe('linear');
  expect(g.stops.map((s) => s.color)).toEqual(['#ff0000', '#0000ff']);
  await expect(page.getByTestId('gradient-handles')).toBeVisible();

  let px = (await decodePixels(page, await exportPng(page), 'image/png', [[110, 200], [250, 200], [390, 200], [50, 50]])).px;
  expect(isReddish(px[0])).toBe(true);
  expect(isBluish(px[2])).toBe(true);
  expect(px[1][0]).toBeGreaterThan(60); // a mix in the middle
  expect(px[1][2]).toBeGreaterThan(60);
  expect(px[3].slice(0, 3)).toEqual([255, 255, 255]); // outside the shape

  // Drag the end handle to the top: the gradient now runs vertically.
  const end = (await page.locator('[data-gradient-handle="end"]').boundingBox())!;
  await drag(page, { x: end.x + end.width / 2, y: end.y + end.height / 2 }, { x: c.x + 130, y: c.y + 100 });
  const moved = (await fill(page)) as G;
  expect(moved.end.x).toBeCloseTo(0.1, 2);
  expect(moved.end.y).toBeCloseTo(0, 2);
  // The box was not resized or moved by that drag.
  expect(await state(page, 's => s.doc.layers[0].children[0].box')).toMatchObject({ x: 100, y: 100, width: 300, height: 200 });
  px = (await decodePixels(page, await exportPng(page), 'image/png', [[390, 110], [390, 295]])).px;
  expect(isBluish(px[0])).toBe(true);
  expect(isReddish(px[1])).toBe(true);
  // One undo step for the handle drag.
  await page.keyboard.press('Control+z');
  expect(((await fill(page)) as G).end).toEqual(g.end);
});

test('radial gradient: center color in the middle, outer color at the corners', async ({ page }) => {
  await gradientRect(page, 'radial');
  expect(((await fill(page)) as G).kind).toBe('radial');
  await expect(props(page).getByLabel('グラデーションの角度')).toHaveCount(0); // no angle for radial
  const px = (await decodePixels(page, await exportPng(page), 'image/png', [[250, 200], [102, 102], [398, 298]])).px;
  expect(isReddish(px[0])).toBe(true);
  expect(isBluish(px[1])).toBe(true);
  expect(isBluish(px[2])).toBe(true);
});

test('conic gradient: colors sweep clockwise from the start direction; angle field turns it', async ({ page }) => {
  await gradientRect(page, 'conic');
  // Start direction is to the right; just below it (clockwise) is near color 1,
  // just above it is near color 2; to the left is half-way.
  let px = (await decodePixels(page, await exportPng(page), 'image/png', [[380, 210], [380, 190], [120, 200]])).px;
  expect(isReddish(px[0])).toBe(true);
  expect(isBluish(px[1])).toBe(true);
  expect(px[2][0]).toBeGreaterThan(80);
  expect(px[2][2]).toBeGreaterThan(80);

  // Turn the start to point down (90°): now just left of the bottom is red.
  const angle = props(page).locator('input[aria-label="グラデーションの角度"]');
  await angle.fill('90');
  await angle.press('Enter');
  px = (await decodePixels(page, await exportPng(page), 'image/png', [[240, 290], [260, 290]])).px;
  expect(isReddish(px[0])).toBe(true);
  expect(isBluish(px[1])).toBe(true);
});

test('gradient colors: add by clicking the bar, set opacity, move, delete, reverse, back to solid', async ({ page }) => {
  await gradientRect(page, 'linear');
  const bar = (await props(page).getByRole('group', { name: '塗りのグラデーション' }).boundingBox())!;
  await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
  let g = (await fill(page)) as G;
  expect(g.stops).toHaveLength(3);
  expect(g.stops[2].offset).toBeCloseTo(0.5, 1);
  expect(g.stops[2].color).toBe('#800080'); // interpolated red/blue
  await expect(props(page).getByRole('button', { name: /^塗りの色3/ })).toHaveAttribute('aria-pressed', 'true');

  // Opacity of the selected color.
  const op = props(page).locator('input[aria-label="色の不透明度"]');
  await op.fill('40');
  await op.press('Enter');
  expect(((await fill(page)) as G).stops[2].opacity).toBeCloseTo(0.4, 5);

  // Keyboard: → moves it 1%, Delete removes it (not the shape).
  const stop3 = props(page).getByRole('button', { name: /^塗りの色3/ });
  await stop3.focus();
  await page.keyboard.press('ArrowRight');
  expect(((await fill(page)) as G).stops[2].offset).toBeCloseTo(0.51, 2);
  await page.keyboard.press('Delete');
  expect(((await fill(page)) as G).stops).toHaveLength(2);
  expect(await state<unknown[]>(page, 's => s.doc.layers[0].children')).toHaveLength(1);
  await expect(props(page).getByRole('button', { name: '色を削除' })).toBeDisabled();

  // Drag a new color along the bar, then down off the bar to remove it.
  await page.mouse.click(bar.x + bar.width * 0.25, bar.y + bar.height / 2);
  const s3 = (await props(page).getByRole('button', { name: /^塗りの色3/ }).boundingBox())!;
  await drag(page, { x: s3.x + s3.width / 2, y: s3.y + s3.height / 2 }, { x: bar.x + bar.width * 0.75, y: s3.y + s3.height / 2 });
  g = (await fill(page)) as G;
  expect(g.stops[2].offset).toBeCloseTo(0.75, 1);
  const s3b = (await props(page).getByRole('button', { name: /^塗りの色3/ }).boundingBox())!;
  await drag(page, { x: s3b.x + s3b.width / 2, y: s3b.y + s3b.height / 2 }, { x: s3b.x + s3b.width / 2, y: s3b.y + 80 });
  expect(((await fill(page)) as G).stops).toHaveLength(2);

  await props(page).getByRole('button', { name: '反転' }).click();
  g = (await fill(page)) as G;
  expect(g.stops.find((s) => s.offset === 0)?.color).toBe('#0000ff');

  await props(page).getByLabel('塗りの種類').selectOption('solid');
  expect(await fill(page)).toBe('#0000ff');
  await expect(page.getByTestId('gradient-handles')).toHaveCount(0);
  // Back to a gradient, then undo returns to the solid color.
  await props(page).getByLabel('塗りの種類').selectOption('radial');
  await page.keyboard.press('Control+z');
  expect(await fill(page)).toBe('#0000ff');
});

test('text color gradient is rendered on the text', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('t');
  await page.mouse.click(c.x + 200, c.y + 200);
  await expect(page.locator('textarea.text-editor')).toBeFocused();
  await page.keyboard.type('グラデーション');
  await page.keyboard.press('Escape');
  await props(page).getByLabel('文字色の種類').selectOption('linear');
  const color = await state<G>(page, 's => s.doc.layers[0].children[0].color');
  expect(color.kind).toBe('linear');
  const id = await state<string>(page, 's => s.doc.layers[0].children[0].id');
  await expect(page.locator(`[data-testid="canvas"] text`)).toHaveAttribute('fill', `url(#screen-fill-${id})`);
  await expect(page.locator(`[data-testid="canvas"] linearGradient#screen-fill-${id} stop`)).toHaveCount(2);
  await expect(page.getByTestId('gradient-handles')).toBeVisible();
});
