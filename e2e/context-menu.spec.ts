import { expect, test, type Page } from '@playwright/test';
import { canvasBox, disableNativePickers, drag, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

type Obj = { id: string; type: string; box: { x: number; y: number; width: number; height: number } };
const objects = (page: Page) => state<Obj[]>(page, 's => s.doc.layers[0].children');

async function rightClick(page: Page, x: number, y: number) {
  await page.mouse.click(x, y, { button: 'right' });
}

async function rect(page: Page, x: number, y: number, w: number, h: number) {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + x, y: c.y + y }, { x: c.x + x + w, y: c.y + y + h });
  return c;
}

test('object menu: right-click selects the object, then copy / paste / duplicate / delete', async ({ page }) => {
  const c = await rect(page, 100, 100, 100, 100);
  await rect(page, 300, 100, 100, 100);
  const [a] = await objects(page);
  // The second rectangle is selected; right-clicking the first selects it instead.
  await rightClick(page, c.x + 150, c.y + 150);
  const menu = page.getByRole('menu', { name: 'オブジェクトのメニュー' });
  await expect(menu).toBeVisible();
  expect(await state<string[]>(page, 's => s.selection')).toEqual([a.id]);
  await menu.getByRole('menuitem', { name: /^複製/ }).click();
  await expect(menu).toHaveCount(0);
  expect(await objects(page)).toHaveLength(3);

  await rightClick(page, c.x + 150, c.y + 150);
  await menu.getByRole('menuitem', { name: /^コピー/ }).click();
  await rightClick(page, c.x + 600, c.y + 400); // empty spot
  const canvasMenu = page.getByRole('menu', { name: 'キャンバスのメニュー' });
  await canvasMenu.getByRole('menuitem', { name: /^ペースト/ }).click();
  // Paste first checks the system clipboard for an image (async).
  await expect.poll(async () => (await objects(page)).length).toBe(4);

  await rightClick(page, c.x + 350, c.y + 150);
  await menu.getByRole('menuitem', { name: /^削除/ }).click();
  expect(await objects(page)).toHaveLength(3);
  await page.keyboard.press('Control+z');
  expect(await objects(page)).toHaveLength(4);
});

test('object menu: cut, stacking order, group / ungroup, align submenu', async ({ page }) => {
  const c = await rect(page, 100, 100, 100, 100);
  await rect(page, 150, 300, 200, 50);
  const [a, b] = await objects(page);
  const menu = page.getByRole('menu', { name: 'オブジェクトのメニュー' });

  await rightClick(page, c.x + 120, c.y + 120);
  await menu.getByRole('menuitem', { name: /^最前面へ/ }).click();
  expect((await objects(page)).map((o) => o.id)).toEqual([b.id, a.id]);
  await rightClick(page, c.x + 120, c.y + 120);
  await menu.getByRole('menuitem', { name: /^最背面へ/ }).click();
  expect((await objects(page)).map((o) => o.id)).toEqual([a.id, b.id]);

  // Select both, then align horizontally through the submenu (hover opens it).
  await page.keyboard.press('Control+a');
  await rightClick(page, c.x + 120, c.y + 120);
  expect(await state<string[]>(page, 's => s.selection')).toHaveLength(2); // right-click inside the selection keeps it
  await menu.getByRole('menuitem', { name: '整列' }).hover();
  await page.getByRole('menu', { name: '整列' }).getByRole('menuitem', { name: '横中央（左右）' }).click();
  const [a2, b2] = await objects(page);
  expect(a2.box.x + a2.box.width / 2).toBeCloseTo(b2.box.x + b2.box.width / 2, 5);

  await page.keyboard.press('Control+a');
  await rightClick(page, c.x + 220, c.y + 150);
  await expect(menu.getByRole('menuitem', { name: /^グループ解除/ })).toBeDisabled();
  await menu.getByRole('menuitem', { name: /^グループ化/ }).click();
  let objs = await objects(page);
  expect(objs.map((o) => o.type)).toEqual(['group']);
  await rightClick(page, c.x + 220, c.y + 150);
  await menu.getByRole('menuitem', { name: /^グループ解除/ }).click();
  objs = await objects(page);
  expect(objs.map((o) => o.type)).toEqual(['shape', 'shape']);

  await page.keyboard.press('Escape');
  await rightClick(page, c.x + 220, c.y + 150);
  await menu.getByRole('menuitem', { name: /^カット/ }).click();
  expect(await objects(page)).toHaveLength(1);
});

test('empty canvas menu: select all and grid toggle; Escape closes without acting', async ({ page }) => {
  const c = await rect(page, 100, 100, 100, 100);
  await rect(page, 300, 100, 100, 100);
  await page.mouse.click(c.x + 600, c.y + 400);
  expect(await state<string[]>(page, 's => s.selection')).toHaveLength(0);
  const menu = page.getByRole('menu', { name: 'キャンバスのメニュー' });
  await rightClick(page, c.x + 600, c.y + 400);
  // ペースト stays available: the system clipboard may hold an image from another app.
  await expect(menu.getByRole('menuitem', { name: /^ペースト/ })).toBeEnabled();
  await menu.getByRole('menuitem', { name: /^すべてを選択/ }).click();
  expect(await state<string[]>(page, 's => s.selection')).toHaveLength(2);

  await rightClick(page, c.x + 600, c.y + 400);
  await menu.getByRole('menuitemcheckbox', { name: 'グリッドを表示' }).click();
  await expect(page.getByTestId('grid')).toBeVisible();
  await rightClick(page, c.x + 600, c.y + 400);
  await expect(menu.getByRole('menuitemcheckbox', { name: 'グリッドを表示' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('grid')).toBeVisible();

  // Clicking elsewhere also closes it.
  await rightClick(page, c.x + 600, c.y + 400);
  await page.mouse.click(c.x + 650, c.y + 450);
  await expect(menu).toHaveCount(0);
});

test('keyboard: Shift+F10 opens the menu for the selection and arrows move through it', async ({ page }) => {
  await rect(page, 100, 100, 100, 100);
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'オブジェクトのメニュー' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^カット/ })).toBeFocused();
  await page.keyboard.press('ArrowDown'); // コピー
  await page.keyboard.press('ArrowDown'); // ペースト
  await page.keyboard.press('ArrowDown'); // 複製
  await expect(menu.getByRole('menuitem', { name: /^複製/ })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await objects(page)).toHaveLength(2);
});

test('path editing from the menu, then anchor menu: add, convert, delete', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('p');
  await page.mouse.click(c.x + 100, c.y + 100);
  await page.mouse.click(c.x + 300, c.y + 100);
  await page.mouse.click(c.x + 300, c.y + 300);
  await page.keyboard.press('Enter');
  await page.keyboard.press('v');
  await rightClick(page, c.x + 200, c.y + 101);
  await page.getByRole('menu', { name: 'オブジェクトのメニュー' }).getByRole('menuitem', { name: 'パスの編集' }).click();
  expect(await state<string>(page, 's => s.tool')).toBe('subselect');
  const nodes = () => state<{ anchor: { x: number; y: number }; in: unknown; out: unknown }[]>(page, 's => s.doc.layers[0].children[0].nodes');

  const menu = page.getByRole('menu', { name: 'パスの点のメニュー' });
  // On the outline: add a point there.
  await rightClick(page, c.x + 150, c.y + 101);
  await menu.getByRole('menuitem', { name: '点の追加' }).click();
  let n = await nodes();
  expect(n).toHaveLength(4);
  const added = (await page.locator('[data-node="1"]').boundingBox())!;
  expect(added.x + added.width / 2 - c.x).toBeCloseTo(150, 0);
  expect(await state<number[]>(page, 's => s.nodeSelection')).toEqual([1]);

  // On an anchor: it becomes the selected one; convert to smooth and back to corner.
  const b = (await page.locator('[data-node="2"]').boundingBox())!;
  await rightClick(page, b.x + b.width / 2, b.y + b.height / 2);
  expect(await state<number[]>(page, 's => s.nodeSelection')).toEqual([2]);
  await menu.getByRole('menuitem', { name: '滑らかな点に変換' }).click();
  n = await nodes();
  expect(n[2].in).not.toBeNull();
  expect(n[2].out).not.toBeNull();
  await rightClick(page, b.x + b.width / 2, b.y + b.height / 2);
  await menu.getByRole('menuitem', { name: '角の点に変換' }).click();
  expect((await nodes())[2]).toMatchObject({ in: null, out: null });

  // Add on an anchor: the middle of the segment after it.
  await rightClick(page, b.x + b.width / 2, b.y + b.height / 2);
  await menu.getByRole('menuitem', { name: '点の追加' }).click();
  expect(await nodes()).toHaveLength(5);
  const mid = (await page.locator('[data-node="3"]').boundingBox())!;
  expect(mid.x + mid.width / 2 - c.x).toBeCloseTo(300, 0);
  expect(mid.y + mid.height / 2 - c.y).toBeCloseTo(200, 0);

  // Delete the anchor.
  await rightClick(page, b.x + b.width / 2, b.y + b.height / 2);
  await menu.getByRole('menuitem', { name: /^点の削除/ }).click();
  expect(await nodes()).toHaveLength(4);
  await page.keyboard.press('Control+z');
  expect(await nodes()).toHaveLength(5);
});

test('text being edited keeps the browser menu', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('t');
  await page.mouse.click(c.x + 300, c.y + 300);
  const ta = page.locator('textarea.text-editor');
  await expect(ta).toBeFocused();
  const prevented = await ta.evaluate((el) => {
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(page.getByRole('menu')).toHaveCount(0);
});
