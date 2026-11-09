// The toolbar: hand and zoom share one button; a window too low for one column of tools
// gets two columns (and one again when it is tall enough).
import { expect, test, type Page } from '@playwright/test';

/** Every tool button inside the window and the toolbar, and none under the workspace. */
async function allToolsInWindow(page: Page) {
  const h = page.viewportSize()!.height;
  const bar = (await page.locator('.toolbar').boundingBox())!;
  const ws = (await page.locator('.center').boundingBox())!;
  for (const b of await page.locator('.toolbar .tool-button').all()) {
    const r = (await b.boundingBox())!;
    expect(r.y + r.height).toBeLessThanOrEqual(h);
    expect(r.x + r.width).toBeLessThanOrEqual(bar.x + bar.width);
    expect(r.x + r.width).toBeLessThanOrEqual(ws.x);
  }
}

test('hand and zoom are one group; H and Z still pick each', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.toolbar .tool-button')).toHaveCount(11); // with the brush group
  await page.keyboard.press('z');
  await expect(page.locator('.toolbar [data-tool="zoom"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('h');
  await expect(page.locator('.toolbar [data-tool="hand"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.toolbar [data-tool="hand"]').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /ズームツール/ })).toBeVisible();
});

test('two columns only when one does not fit', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/');
  await expect(page.locator('.toolbar')).toHaveAttribute('data-columns', '1');
  await allToolsInWindow(page);
  await page.setViewportSize({ width: 1200, height: 360 });
  await expect(page.locator('.toolbar')).toHaveAttribute('data-columns', '2');
  await allToolsInWindow(page);
  // The flyouts still open (not clipped) in two columns.
  await page.locator('.toolbar [data-tool="rect"]').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '楕円ツール' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.locator('.toolbar')).toHaveAttribute('data-columns', '1');
});
