// 最近使ったファイル (2026-11-17): files saved or opened are listed in ファイル → 最近使ったファイル
// (newest first, as many as 環境設定 says) and open again from there. The browser's file
// dialogs are replaced by files in the origin-private file system (real handles, which can be
// kept in IndexedDB like the ones from the dialogs).
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const dir = () => navigator.storage.getDirectory();
    // 保存: a file named window.__save (or the suggestion); 開く: the file named in window.__open.
    w.showSaveFilePicker = async (o: { suggestedName?: string }) => (await dir()).getFileHandle(String(w.__save ?? o.suggestedName ?? 'x'), { create: true });
    w.showOpenFilePicker = async () => [await (await dir()).getFileHandle(String(w.__open))];
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
});

async function recentItems(page: Page) {
  const entry = page.getByRole('menuitem', { name: '最近使ったファイル' });
  if (!(await entry.isVisible())) await page.getByRole('button', { name: 'ファイル', exact: true }).click();
  await entry.hover();
  const sub = page.locator('.menubar-sub');
  await expect(sub.getByRole('menuitem').first()).toBeVisible();
  return sub.getByRole('menuitem').allTextContents();
}

/** Close the File menu (a click on its button). */
async function closeMenu(page: Page) {
  if (await page.getByRole('menuitem', { name: '最近使ったファイル' }).isVisible()) await page.getByRole('button', { name: 'ファイル', exact: true }).click();
  await expect(page.locator('.menubar-sub')).toHaveCount(0);
}

/** The submenu's item (open it first with recentItems). */
const recentItem = (page: Page, name: string | RegExp) => page.locator('.menubar-sub').getByRole('menuitem', { name });

async function newRect(page: Page) {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await page.mouse.move(c.x + 100, c.y + 100);
  await page.mouse.down();
  await page.mouse.move(c.x + 200, c.y + 200, { steps: 3 });
  await page.mouse.up();
}

test('saved and opened files are listed newest first and open again; 保存 then writes back', async ({ page }) => {
  await expect.poll(async () => (await recentItems(page)).join()).toContain('まだありません');
  await closeMenu(page);

  // Save a project with a rectangle.
  await closeMenu(page);
  await newRect(page);
  expect(await state<number>(page, 's => s.doc.layers[0].children.length')).toBe(1);
  await page.keyboard.press('Control+s');
  await expect(page.locator('.notice').last()).toContainText('保存しました');
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(() => state<string>(page, 's => s.fileName')).toMatch(/\.hnb\.png$/);
  let items = await recentItems(page);
  expect(items[0]).toMatch(/^untitled\.hnb\.png/);
  await closeMenu(page);

  // Reload: the list is kept; open the file from it.
  await page.reload();
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
  items = await recentItems(page);
  expect(items.some((t) => t.startsWith('untitled.hnb.png'))).toBe(true);
  await recentItem(page, /^untitled\.hnb\.png/).click();
  await expect.poll(() => state<number>(page, 's => s.doc.layers[0].children.length')).toBe(1);
  expect(await state(page, 's => s.fileName')).toBe('untitled.hnb.png');
  // Opened with its handle: 保存 writes back to it without asking.
  expect(await state(page, 's => !!s.fileHandle')).toBe(true);
});

test('開く records the file; the number kept follows 環境設定 and 履歴を消去 empties it', async ({ page }) => {
  // Three saved files.
  for (const name of ['a', 'b', 'c']) {
    await page.evaluate((n) => ((window as unknown as Record<string, unknown>).__save = `${n}.hnb`), name);
    await newRect(page);
    await page.keyboard.press('Control+Shift+s');
    await expect.poll(() => state<string>(page, 's => s.fileName')).toBe(`${name}.hnb`);
  }
  expect((await recentItems(page)).slice(0, 3).map((t) => t.split(/\d/)[0])).toEqual(['c.hnb', 'b.hnb', 'a.hnb']);
  await closeMenu(page);

  // 開く a.hnb: it goes to the top.
  await closeMenu(page);
  await page.evaluate(() => ((window as unknown as Record<string, unknown>).__open = 'a.hnb'));
  await page.keyboard.press('Control+o');
  await expect.poll(() => state<string>(page, 's => s.fileName')).toBe('a.hnb');
  expect((await recentItems(page))[0]).toMatch(/^a\.hnb/);
  await closeMenu(page);

  // Keep 2: the oldest goes.
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.getByRole('menuitem', { name: '環境設定…' }).click();
  const prefs = page.getByRole('dialog', { name: '環境設定' });
  const n = prefs.getByLabel('最近使ったファイルの数');
  await n.fill('2');
  await n.press('Enter');
  await prefs.getByRole('button', { name: '閉じる' }).click();
  await expect.poll(async () => (await recentItems(page)).filter((t) => /\.hnb/.test(t)).length).toBe(2);
  await closeMenu(page);

  page.once('dialog', (d) => void d.accept());
  await recentItems(page);
  await recentItem(page, '履歴を消去').click();
  await expect.poll(async () => (await recentItems(page)).join()).toContain('まだありません');
});
