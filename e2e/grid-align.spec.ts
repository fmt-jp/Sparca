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
