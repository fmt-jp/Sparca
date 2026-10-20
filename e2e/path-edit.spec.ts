import { expect, test, type Page } from '@playwright/test';
import { canvasBox, disableNativePickers, drag, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

type Node = { anchor: { x: number; y: number }; in: unknown; out: unknown };
const pathNodes = (page: Page) => state<Node[]>(page, 's => s.doc.layers[0].children[0].nodes');

/** Screen center of an anchor / handle marker. */
async function centerOf(page: Page, selector: string) {
  const b = (await page.locator(selector).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Open path (100,100) → (300,100) → (300,300) drawn with the pen, then switched to subselect. */
async function drawPath(page: Page) {
  const c = await canvasBox(page);
  await page.keyboard.press('p');
  await page.mouse.click(c.x + 100, c.y + 100);
  await page.mouse.click(c.x + 300, c.y + 100);
  await page.mouse.click(c.x + 300, c.y + 300);
  await page.keyboard.press('Enter');
  await page.keyboard.press('a');
  await expect(page.getByTestId('path-nodes').locator('[data-node]')).toHaveCount(3);
  return c;
}

test('drags anchors to reshape a path; the box refits and undo restores', async ({ page }) => {
  const c = await drawPath(page);
  const a = await centerOf(page, '[data-node="2"]');
  await drag(page, a, { x: a.x + 100, y: a.y + 50 });
  await expect.poll(async () => centerOf(page, '[data-node="2"]')).toEqual({ x: a.x + 100, y: a.y + 50 });
  // Other anchors did not move.
  expect(await centerOf(page, '[data-node="0"]')).toEqual({ x: c.x + 100, y: c.y + 100 });
  const box = await state<{ x: number; y: number; width: number; height: number }>(page, 's => s.doc.layers[0].children[0].box');
  expect(box).toMatchObject({ x: 100, y: 100, width: 300, height: 250 });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => centerOf(page, '[data-node="2"]')).toEqual(a);
});

test('double-click converts corner ↔ smooth; dragging a handle keeps a smooth point smooth', async ({ page }) => {
  await drawPath(page);
  await page.locator('[data-node="1"]').dblclick();
  let nodes = await pathNodes(page);
  expect(nodes[1].in).not.toBeNull();
  expect(nodes[1].out).not.toBeNull();
  await expect(page.locator('[data-node-handle]')).toHaveCount(2);
  const h = await centerOf(page, '[data-node-handle="1:out"]');
  const anchor = await centerOf(page, '[data-node="1"]');
  await drag(page, h, { x: anchor.x, y: anchor.y + 80 });
  // The opposite handle turned with it: it is now straight above the anchor.
  const hin = await centerOf(page, '[data-node-handle="1:in"]');
  expect(Math.abs(hin.x - anchor.x)).toBeLessThan(1.5);
  expect(hin.y).toBeLessThan(anchor.y);
  // Alt-drag breaks the handles apart.
  const hout = await centerOf(page, '[data-node-handle="1:out"]');
  await page.keyboard.down('Alt');
  await drag(page, hout, { x: anchor.x + 60, y: anchor.y });
  await page.keyboard.up('Alt');
  const hin2 = await centerOf(page, '[data-node-handle="1:in"]');
  expect(hin2).toEqual(hin);
  // Double-click again: back to a corner.
  await page.locator('[data-node="1"]').dblclick();
  nodes = await pathNodes(page);
  expect(nodes[1]).toMatchObject({ in: null, out: null });
});

test('adds an anchor by double-clicking the outline and deletes selected anchors', async ({ page }) => {
  const c = await drawPath(page);
  await page.mouse.dblclick(c.x + 200, c.y + 101); // middle of the first segment
  expect(await pathNodes(page)).toHaveLength(4);
  await expect(page.locator('[data-node="1"].selected')).toHaveCount(1);
  const added = await centerOf(page, '[data-node="1"]');
  expect(added.x).toBeCloseTo(c.x + 200, 0);
  expect(added.y).toBeCloseTo(c.y + 100, 0);
  // Shift-select a second anchor and delete both.
  await page.locator('[data-node="2"]').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Delete');
  const nodes = await pathNodes(page);
  expect(nodes).toHaveLength(2);
  // The path object itself is still there (Delete removed anchors, not the object).
  expect(await state<number>(page, 's => s.doc.layers[0].children.length')).toBe(1);
});

test('marquee-selects anchors, nudges them with arrow keys and edits them in the panel', async ({ page }) => {
  const c = await drawPath(page);
  await drag(page, { x: c.x + 250, y: c.y + 50 }, { x: c.x + 350, y: c.y + 350 }); // anchors 1 and 2
  expect(await state<number[]>(page, 's => s.nodeSelection')).toEqual([1, 2]);
  await page.keyboard.press('Shift+ArrowRight');
  expect(await centerOf(page, '[data-node="1"]')).toEqual({ x: c.x + 310, y: c.y + 100 });
  expect(await centerOf(page, '[data-node="2"]')).toEqual({ x: c.x + 310, y: c.y + 300 });
  await page.locator('[data-node="0"]').click();
  const panel = page.getByTestId('path-node-panel');
  const x = panel.locator('input[aria-label="アンカー X"]');
  await x.fill('50');
  await x.press('Enter');
  expect(await centerOf(page, '[data-node="0"]')).toEqual({ x: c.x + 50, y: c.y + 100 });
  await panel.getByLabel('パスを閉じる').check();
  expect(await state<boolean>(page, 's => s.doc.layers[0].children[0].closed')).toBe(true);
});

test('editing a rotated path keeps anchors under the pointer', async ({ page }) => {
  const c = await drawPath(page);
  await page.keyboard.press('v');
  const rot = page.getByRole('region', { name: 'プロパティ' }).locator('input[aria-label="回転"]');
  await rot.fill('45');
  await rot.press('Enter');
  await page.keyboard.press('a');
  const a = await centerOf(page, '[data-node="0"]');
  await drag(page, a, { x: a.x - 30, y: a.y + 20 });
  const after = await centerOf(page, '[data-node="0"]');
  expect(Math.abs(after.x - (a.x - 30))).toBeLessThan(1.5);
  expect(Math.abs(after.y - (a.y + 20))).toBeLessThan(1.5);
  expect(await state<number>(page, 's => s.doc.layers[0].children[0].box.rotation')).toBe(45);
  void c;
});

test('double-clicking a path with the select tool starts anchor editing', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('p');
  await page.mouse.click(c.x + 100, c.y + 400);
  await page.mouse.click(c.x + 400, c.y + 400);
  await page.keyboard.press('Enter');
  await page.keyboard.press('v');
  await page.mouse.dblclick(c.x + 250, c.y + 400);
  expect(await state<string>(page, 's => s.tool')).toBe('subselect');
  await expect(page.getByTestId('path-nodes').locator('[data-node]')).toHaveCount(2);
});
