// 自動保存 (2026-11-10): unsaved tabs are kept in the browser; at start, work left by a window
// that is gone is restored after asking, or at once (環境設定).
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, disableNativePickers, drag, state } from './helpers';

const ready = (page: Page) => expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
const flush = (page: Page) => page.evaluate(() => (window as unknown as { __sparcaAutosave: { flush(): Promise<void> } }).__sparcaAutosave.flush());
const records = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('hanabi-autosave', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('tabs', { keyPath: 'key' });
        req.onsuccess = () => {
          const r = req.result.transaction('tabs').objectStore('tabs').count();
          r.onsuccess = () => {
            req.result.close();
            resolve(r.result);
          };
        };
      }),
  );
const objectCount = (page: Page) => state<number>(page, 's => s.doc.layers.flatMap(l => l.children).length');

async function drawRect(page: Page) {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 200, y: c.y + 200 });
}

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  // Leave the page without the "unsaved changes" prompt, like a crash or a closed window.
  await page.addInitScript(() => window.addEventListener('beforeunload', (e) => e.stopImmediatePropagation(), true));
  await page.goto('/');
  await ready(page);
});

test('unsaved work is offered after a reload and restored as an unsaved tab; 破棄 forgets it', async ({ page }) => {
  await drawRect(page);
  await flush(page);
  expect(await records(page)).toBe(1);
  await page.reload();
  await ready(page);
  const dlg = page.getByRole('dialog', { name: '作業の復元' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('restore-list')).toContainText('名称未設定');
  await dlg.getByRole('button', { name: '復元' }).click();
  await expect.poll(() => objectCount(page)).toBe(1);
  expect(await state(page, 's => s.tabs.find(t => t.id === s.activeTabId).dirty')).toBe(true);
  expect(await state(page, 's => s.fileHandle')).toBeNull();
  expect(await records(page)).toBe(0);
  // Again, but discarded this time.
  await flush(page);
  await page.reload();
  await ready(page);
  await page.getByRole('dialog', { name: '作業の復元' }).getByRole('button', { name: '破棄' }).click();
  await expect.poll(() => records(page)).toBe(0);
  expect(await objectCount(page)).toBe(0);
  await page.reload();
  await ready(page);
  await expect(page.getByRole('dialog', { name: '作業の復元' })).toHaveCount(0);
});

test('「あとで」 keeps the work for next time; 自動で復元 (環境設定) restores without asking', async ({ page }) => {
  await drawRect(page);
  await flush(page);
  await page.reload();
  await ready(page);
  await page.getByRole('dialog', { name: '作業の復元' }).getByRole('button', { name: 'あとで' }).click();
  expect(await records(page)).toBe(1);
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.getByRole('menuitem', { name: '環境設定…' }).click();
  await page.getByRole('dialog', { name: '環境設定' }).getByRole('radio', { name: '自動で復元' }).check();
  await page.getByRole('dialog', { name: '環境設定' }).getByRole('button', { name: '閉じる' }).click();
  await page.reload();
  await ready(page);
  await expect.poll(() => objectCount(page)).toBe(1);
  await expect(page.getByRole('dialog', { name: '作業の復元' })).toHaveCount(0);
  await expect(page.locator('.notice')).toContainText('復元しました');
});

test('saving to a file removes the copy; work of another open window is not offered', async ({ page, context }) => {
  await drawRect(page);
  await flush(page);
  expect(await records(page)).toBe(1);
  // Another HANABI window while this one is open: nothing to restore.
  const other = await context.newPage();
  await other.goto('/');
  await ready(other);
  await other.waitForTimeout(300);
  await expect(other.getByRole('dialog', { name: '作業の復元' })).toHaveCount(0);
  await other.close();
  // Saved (download): the copy goes.
  const dl = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  await dl;
  await expect.poll(() => records(page)).toBe(0);
});
