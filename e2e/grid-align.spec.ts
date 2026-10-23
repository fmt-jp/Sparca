import { expect, test, type Page } from '@playwright/test';
import { canvasBox, drag, setColor, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

type Box = { x: number; y: number; width: number; height: number };
const boxes = (page: Page) => state<Box[]>(page, 's => s.doc.layers[0].children.map(o => o.box)');

test('drawing tools return to the select tool after creating something', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 50, y: c.y + 50 }, { x: c.x + 150, y: c.y + 150 });
  expect(await state<string>(page, 's => s.tool')).toBe('select');
  // Clicking the canvas now selects/deselects instead of adding another shape.
  await page.mouse.click(c.x + 400, c.y + 400);
  expect(await boxes(page)).toHaveLength(1);
  // Text: after typing and confirming.
  await page.keyboard.press('t');
  await page.mouse.click(c.x + 300, c.y + 300);
  await expect(page.locator('textarea.text-editor')).toBeFocused();
  await page.keyboard.type('abc');
  await page.keyboard.press('Escape');
  expect(await state<string>(page, 's => s.tool')).toBe('select');
  await page.mouse.click(c.x + 500, c.y + 500);
  expect(await boxes(page)).toHaveLength(2);
  // Line.
  await page.keyboard.press('n');
  await drag(page, { x: c.x + 100, y: c.y + 450 }, { x: c.x + 300, y: c.y + 450 });
  expect(await state<string>(page, 's => s.tool')).toBe('select');
  // Changing a property of the new shape and clicking the canvas adds nothing.
  const sw = page.getByRole('region', { name: 'プロパティ' }).locator('input[type="text"][aria-label="線幅"]');
  await sw.fill('6');
  await sw.press('Enter');
  await page.mouse.click(c.x + 700, c.y + 100);
  expect(await boxes(page)).toHaveLength(3);
});

test('grid: show, spacing, color, and snapping (also remembered after reload)', async ({ page }) => {
  await page.getByRole('button', { name: '表示', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'グリッドを表示' }).click();
  await expect(page.getByTestId('grid')).toBeVisible();
  // Settings dialog: spacing 50, red, snap on.
  await page.getByRole('button', { name: '表示', exact: true }).click();
  await page.getByRole('menuitem', { name: 'グリッド設定…' }).click();
  const dlg = page.getByRole('dialog', { name: 'グリッド設定' });
  const size = dlg.locator('input[aria-label="グリッドの間隔"]');
  await size.fill('50');
  await size.press('Enter');
  await setColor(page, dlg, 'グリッドの色', '#ff0000');
  await dlg.getByLabel(/グリッドにスナップ/).check();
  await dlg.getByRole('button', { name: '閉じる' }).click();
  await expect(page.locator('#sparca-grid')).toHaveAttribute('width', '50');
  await expect(page.locator('#sparca-grid path')).toHaveAttribute('stroke', '#ff0000');

  // Drawing snaps to the grid.
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 61, y: c.y + 38 }, { x: c.x + 190, y: c.y + 163 });
  expect((await boxes(page))[0]).toMatchObject({ x: 50, y: 50, width: 150, height: 100 });
  // Moving snaps the top-left to the grid.
  await drag(page, { x: c.x + 120, y: c.y + 100 }, { x: c.x + 143, y: c.y + 171 });
  expect((await boxes(page))[0]).toMatchObject({ x: 50, y: 100 });
  // Snap off: free placement.
  await page.getByLabel('スナップ', { exact: true }).uncheck();
  await drag(page, { x: c.x + 120, y: c.y + 150 }, { x: c.x + 127, y: c.y + 163 });
  expect((await boxes(page))[0]).toMatchObject({ x: 57, y: 113 });

  // The grid is not part of the exported image or the document.
  expect(await state<unknown>(page, 's => JSON.stringify(s.doc).includes("grid")')).toBe(false);

  // Settings survive a reload (per-browser preference).
  await page.reload();
  await expect(page.getByTestId('grid')).toBeVisible();
  await expect(page.locator('#sparca-grid')).toHaveAttribute('width', '50');
});

test('align multiple shapes on their horizontal and vertical centers, or to the canvas', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 50, y: c.y + 50 }, { x: c.x + 150, y: c.y + 100 }); // 100×50, center (100, 75)
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 300, y: c.y + 200 }, { x: c.x + 340, y: c.y + 300 }); // 40×100, center (320, 250)
  await page.keyboard.press('Control+a');
  const props = page.getByRole('region', { name: 'プロパティ' });

  await props.getByRole('button', { name: '横中央（左右）' }).click();
  let b = await boxes(page);
  expect(b[0].x + b[0].width / 2).toBeCloseTo(b[1].x + b[1].width / 2); // same horizontal center
  expect(b[0].x + b[0].width / 2).toBeCloseTo(195); // middle of the selection (50..340)

  await props.getByRole('button', { name: '縦中央（上下）' }).click();
  b = await boxes(page);
  expect(b[0].y + b[0].height / 2).toBeCloseTo(b[1].y + b[1].height / 2);

  // Relative to the canvas (800×600): both end up centered on it.
  await props.getByLabel('キャンバスに対して').check();
  await props.getByRole('button', { name: '横中央（左右）' }).click();
  await props.getByRole('button', { name: '縦中央（上下）' }).click();
  b = await boxes(page);
  for (const o of b) {
    expect(o.x + o.width / 2).toBeCloseTo(400);
    expect(o.y + o.height / 2).toBeCloseTo(300);
  }
  // Also available from the 変更 menu; one undo step per alignment.
  await page.keyboard.press('Control+z');
  b = await boxes(page);
  expect(b[0].y + b[0].height / 2).not.toBeCloseTo(300);
  await page.getByRole('button', { name: '変更' }).click();
  await page.getByRole('menuitem', { name: '整列：縦中央（上下）' }).click();
  b = await boxes(page);
  expect(b[0].y + b[0].height / 2).toBeCloseTo(300);
});

test('align shortcuts Ctrl+Alt+1..6 and distribute Ctrl+Alt+7 / 9 (equal gaps)', async ({ page }) => {
  const c = await canvasBox(page);
  // Three rectangles of different sizes, unevenly spaced.
  for (const [x, y, w, h] of [[50, 50, 60, 40], [200, 150, 100, 80], [500, 300, 40, 120]]) {
    await page.keyboard.press('r');
    await drag(page, { x: c.x + x, y: c.y + y }, { x: c.x + x + w, y: c.y + y + h });
  }
  await page.keyboard.press('Control+a');

  await page.keyboard.press('Control+Alt+7');
  let b = await boxes(page);
  const gaps = (bs: Box[], ax: 'x' | 'y', sz: 'width' | 'height') => {
    const s = [...bs].sort((p, q) => p[ax] - q[ax]);
    return s.slice(1).map((q, i) => q[ax] - (s[i][ax] + s[i][sz]));
  };
  const [g1, g2] = gaps(b, 'x', 'width');
  expect(g1).toBeCloseTo(g2, 5);
  expect(Math.min(...b.map((q) => q.x))).toBe(50); // the outer ones stay
  expect(Math.max(...b.map((q) => q.x + q.width))).toBe(540);
  expect(await state<string>(page, 's => s.history.past[s.history.past.length - 1].label')).toBe('均等配置');

  await page.keyboard.press('Control+Alt+9');
  b = await boxes(page);
  const [v1, v2] = gaps(b, 'y', 'height');
  expect(v1).toBeCloseTo(v2, 5);

  await page.keyboard.press('Control+Alt+1');
  b = await boxes(page);
  expect(new Set(b.map((q) => q.x))).toEqual(new Set([50]));
  await page.keyboard.press('Control+Alt+6');
  b = await boxes(page);
  expect(new Set(b.map((q) => q.y + q.height)).size).toBe(1);
  await page.keyboard.press('Control+Alt+2');
  b = await boxes(page);
  expect(new Set(b.map((q) => q.x + q.width / 2)).size).toBe(1);
  await page.keyboard.press('Control+z');
  b = await boxes(page);
  expect(new Set(b.map((q) => q.x))).toEqual(new Set([50])); // one undo step per command

  // Menus show the shortcuts; distributing two objects needs 「キャンバスに対して」.
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /整列：左揃え/ })).toContainText('Ctrl+Alt+1');
  await expect(page.getByRole('menuitem', { name: /整列：均等配置（高さ）/ })).toContainText('Ctrl+Alt+9');
  await page.keyboard.press('Escape');
});

test('distributing two objects across the canvas puts them at its edges', async ({ page }) => {
  const c = await canvasBox(page);
  for (const [x, y] of [[100, 100], [300, 200]]) {
    await page.keyboard.press('r');
    await drag(page, { x: c.x + x, y: c.y + y }, { x: c.x + x + 50, y: c.y + y + 50 });
  }
  await page.keyboard.press('Control+a');
  // Without 「キャンバスに対して」 two objects can't be distributed.
  await page.keyboard.press('Control+Alt+7');
  await expect(page.locator('.notice')).toContainText('3つ以上');
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /整列：均等配置（幅）/ })).toBeDisabled();
  await page.getByRole('menuitemcheckbox', { name: '整列：キャンバスに対して' }).click();
  await page.keyboard.press('Control+Alt+7');
  const b = await boxes(page);
  expect(b.map((q) => q.x).sort((p, q) => p - q)).toEqual([0, 750]); // canvas 800 wide
});
