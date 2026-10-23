import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const layers = (page: Page) => page.locator('aside.layers-panel');
const props = (page: Page) => page.getByRole('region', { name: 'プロパティ' });

/** Canvas center minus workspace center (x, y): stays ~0 when the view keeps its center. */
async function offCenter(page: Page) {
  const ws = (await page.getByTestId('workspace').boundingBox())!;
  const cv = (await page.getByTestId('canvas').boundingBox())!;
  return { x: cv.x + cv.width / 2 - (ws.x + ws.width / 2), y: cv.y + cv.height / 2 - (ws.y + ws.height / 2) };
}

test('the layers and properties panels can be hidden to enlarge the canvas area, and brought back', async ({ page }) => {
  const ws0 = (await page.getByTestId('workspace').boundingBox())!;
  const c0 = await offCenter(page);

  await page.getByRole('button', { name: 'レイヤーパネルを隠す' }).click();
  await expect(layers(page)).toHaveCount(0);
  const ws1 = (await page.getByTestId('workspace').boundingBox())!;
  expect(ws1.width).toBeGreaterThan(ws0.width + 200);
  const c1 = await offCenter(page);
  expect(Math.abs(c1.x - c0.x)).toBeLessThanOrEqual(2); // still centered the same way

  await page.getByRole('button', { name: 'プロパティパネルを隠す' }).click();
  await expect(props(page)).toHaveCount(0);
  const ws2 = (await page.getByTestId('workspace').boundingBox())!;
  expect(ws2.height).toBeGreaterThan(ws1.height + 150);

  // The tabs stay on the window edge to bring the panels back.
  await page.getByRole('button', { name: 'レイヤーパネルを表示' }).click();
  await expect(layers(page)).toBeVisible();
  await page.getByRole('button', { name: 'プロパティパネルを表示' }).click();
  await expect(props(page)).toBeVisible();
  expect((await page.getByTestId('workspace').boundingBox())!.width).toBeCloseTo(ws0.width, 0);
});

test('F4 and the 表示 menu hide / show the panels; the choice is remembered', async ({ page }) => {
  await expect(layers(page)).toBeVisible();
  await page.keyboard.press('F4');
  await expect(layers(page)).toHaveCount(0);
  await expect(props(page)).toHaveCount(0);
  await page.keyboard.press('F4');
  await expect(layers(page)).toBeVisible();
  await expect(props(page)).toBeVisible();

  await page.getByRole('button', { name: '表示', exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'プロパティパネル' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemcheckbox', { name: 'プロパティパネル' }).click();
  await expect(props(page)).toHaveCount(0);
  await expect(layers(page)).toBeVisible();

  await page.reload();
  await expect(props(page)).toHaveCount(0);
  await page.getByRole('button', { name: '表示', exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'プロパティパネル' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('menuitem', { name: /パネルをすべて隠す/ }).click();
  await expect(layers(page)).toHaveCount(0);
  await page.getByRole('button', { name: '表示', exact: true }).click();
  await page.getByRole('menuitem', { name: /パネルをすべて表示/ }).click();
  await expect(layers(page)).toBeVisible();
  await expect(props(page)).toBeVisible();
});
