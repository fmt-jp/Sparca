import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** Offset of the canvas center from the workspace (view) center, in screen px. */
async function offCenter(page: Page) {
  const ws = (await page.getByTestId('workspace').boundingBox())!;
  const cv = (await page.getByTestId('canvas').boundingBox())!;
  return { dx: cv.x + cv.width / 2 - (ws.x + ws.width / 2), dy: cv.y + cv.height / 2 - (ws.y + ws.height / 2) };
}

test('zoom in/out keeps the canvas centered in the view', async ({ page }) => {
  // Start from an off-center view.
  await page.getByTestId('workspace').evaluate((el) => {
    el.scrollLeft += 150;
    el.scrollTop += 90;
  });
  for (const name of ['ズームアウト', 'ズームアウト', 'ズームイン']) {
    await page.getByRole('button', { name, exact: true }).click();
    const o = await offCenter(page);
    // Canvas fits the view at these zoom levels → exactly centered (scrollbar rounding aside).
    expect(Math.abs(o.dx)).toBeLessThanOrEqual(8);
    expect(Math.abs(o.dy)).toBeLessThanOrEqual(8);
  }
});

test('zooming in beyond the view keeps the same spot in the middle', async ({ page }) => {
  const zoomIn = page.getByRole('button', { name: 'ズームイン', exact: true });
  for (let i = 0; i < 4; i++) await zoomIn.click(); // 100% → 400%
  expect(await page.evaluate(() => (window as never as { __sparca: { getState(): { zoom: number } } }).__sparca.getState().zoom)).toBe(4);
  const o = await offCenter(page);
  expect(Math.abs(o.dx)).toBeLessThanOrEqual(8);
  expect(Math.abs(o.dy)).toBeLessThanOrEqual(8);
  // Keyboard and the zoom select behave the same.
  await page.keyboard.press('Control+-');
  await page.getByLabel('表示倍率').selectOption('0.5');
  const o2 = await offCenter(page);
  expect(Math.abs(o2.dx)).toBeLessThanOrEqual(8);
  expect(Math.abs(o2.dy)).toBeLessThanOrEqual(8);
});
