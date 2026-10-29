// A page opened before an app update must keep working after the update replaced the
// split-off files on the server (they are fetched right after startup), and say what to
// do if one still cannot be loaded.
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, disableNativePickers, drag, makePng, placePng, state } from './helpers';

const SPLIT_FILES = /\/assets\/(rasterize|svgExport|fontNames|pathBoolean|worker)-[^/]+\.js$/;

async function shapeFillAfterEyedropper(page: Page) {
  await placePng(page, 'red.png', makePng(100, 100, () => [220, 30, 40, 255]));
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 20, y: c.y + 20 }, { x: c.x + 80, y: c.y + 80 });
  await page.keyboard.press('i');
  await page.mouse.click(c.x + 400, c.y + 300);
}

test('split-off files are fetched at startup, so the eyedropper and export work after an update', async ({ page }) => {
  await disableNativePickers(page);
  const fetched = new Set<string>();
  page.on('requestfinished', (r) => {
    const m = SPLIT_FILES.exec(new URL(r.url()).pathname);
    if (m) fetched.add(m[1]);
  });
  await page.goto('/');
  await expect.poll(() => [...fetched].sort()).toEqual(['fontNames', 'pathBoolean', 'rasterize', 'svgExport', 'worker']);
  // "Update": the old files are gone from the server.
  await page.route(SPLIT_FILES, (route) => route.fulfill({ status: 404, body: '' }));
  await shapeFillAfterEyedropper(page);
  await expect(page.getByTestId('picked-color')).toHaveText('#dc1e28');
  expect(await state<string>(page, 's => s.doc.layers[0].children.find(o => o.type === "shape").fill')).toBe('#dc1e28');
  await expect(page.locator('.notice.error')).toHaveCount(0);
  // Export still works too.
  await page.keyboard.press('Control+Shift+E');
  const dl = page.waitForEvent('download');
  await page.getByRole('dialog', { name: '画像として書き出し' }).getByRole('button', { name: '書き出し' }).click();
  expect((await dl).suggestedFilename()).toBe('untitled.png');
});

test('when a split-off file cannot be loaded, the error says to save and reload', async ({ page }) => {
  await disableNativePickers(page);
  // The files are missing from the start (e.g. the update happened during startup).
  await page.route(/\/assets\/(rasterize|svgExport|fontNames)-[^/]+\.js$/, (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await shapeFillAfterEyedropper(page);
  await expect(page.locator('.notice.error')).toContainText('アプリが更新されたため');
  await expect(page.locator('.notice.error')).toContainText('保存');
  await expect(page.locator('.notice.error')).not.toContainText('Failed to fetch');
});
