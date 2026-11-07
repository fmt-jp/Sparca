// Menus and submenus of the menu bar stay inside a low window (moved up, then scrolling).
import { expect, test, type Locator, type Page } from '@playwright/test';

async function inWindow(page: Page, el: Locator) {
  const b = (await el.boundingBox())!;
  const h = page.viewportSize()!.height;
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height).toBeLessThanOrEqual(h);
}

for (const height of [620, 420, 300]) {
  test(`変更 → 整列 fits a ${height} px high window`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height });
    await page.goto('/');
    await page.getByRole('button', { name: '変更', exact: true }).click();
    const menu = page.getByRole('menu', { name: '変更' });
    await inWindow(page, menu);
    const item = menu.getByRole('menuitem', { name: '整列', exact: true });
    await item.scrollIntoViewIfNeeded();
    await item.hover();
    const sub = page.getByRole('menu', { name: '整列' });
    await expect(sub).toBeVisible();
    await inWindow(page, sub);
    // Its last item can be reached (scrolled to when the window is very low) and used.
    const last = sub.getByRole('menuitemcheckbox', { name: 'キャンバスに対して整列' });
    await last.scrollIntoViewIfNeeded();
    await inWindow(page, last);
    await last.click();
    expect(await page.evaluate(() => (window as unknown as { __sparca: { getState(): { alignToCanvas: boolean } } }).__sparca.getState().alignToCanvas)).toBe(true);
  });
}
