import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canvasBox, disableNativePickers, drag, makePng, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

const objects = (page: import('@playwright/test').Page) =>
  state<{ type: string; name: string }[]>(page, 's => s.doc.layers.flatMap(l => l.children.map(o => ({ type: o.type, name: o.name, box: o.box })))');

test('the app is called HANABI: top-left icon and name in orange, the browser tab title and icon', async ({ page }) => {
  const name = page.locator('header.menubar .app-name');
  await expect(name).toHaveText('HANABI');
  await expect(name).toHaveCSS('color', 'rgb(255, 140, 26)');
  await expect(page).toHaveTitle('名称未設定 — HANABI');
  // The fireworks icon: next to the name and as the browser tab icon.
  const icon = name.locator('img.app-icon');
  await expect(icon).toBeVisible();
  expect(await icon.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const tabIcon = await page.evaluate(async () => {
    const res = await fetch(document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href);
    return [res.status, res.headers.get('content-type')];
  });
  expect(tabIcon[0]).toBe(200);
  expect(tabIcon[1]).toContain('svg');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await expect(page.getByRole('menuitem', { name: /^開く…（\.hnb／/ })).toBeVisible();
});

test('draws shapes and text, then undo/redo restores them', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 50, y: c.y + 50 }, { x: c.x + 250, y: c.y + 150 });
  await page.locator('[data-tool="line"]').click();
  await drag(page, { x: c.x + 50, y: c.y + 300 }, { x: c.x + 300, y: c.y + 320 });
  await page.keyboard.press('t');
  await page.mouse.click(c.x + 400, c.y + 400);
  await expect(page.locator('textarea.text-editor')).toBeFocused();
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  expect((await objects(page)).map((o) => o.type)).toEqual(['shape', 'path', 'text']);
  await expect(page.locator('[data-testid=canvas] text')).toHaveText('Hello');

  await page.keyboard.press('v');
  await page.keyboard.press('Control+z');
  expect(await objects(page)).toHaveLength(2);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await objects(page)).toHaveLength(0);
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  expect(await objects(page)).toHaveLength(3);
});

test('selects, moves, resizes and rotates with handles', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 200, y: c.y + 200 });
  await page.keyboard.press('v');
  // Move
  await drag(page, { x: c.x + 150, y: c.y + 150 }, { x: c.x + 200, y: c.y + 170 });
  let box = (await objects(page))[0] as unknown as { box: { x: number; y: number; width: number; height: number; rotation: number } };
  expect(box.box.x).toBeCloseTo(150, 0);
  expect(box.box.y).toBeCloseTo(120, 0);
  // Resize via the south-east handle
  const se = page.locator('[data-handle="se"]');
  const h = (await se.boundingBox())!;
  await drag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: h.x + h.width / 2 + 50, y: h.y + h.height / 2 + 30 });
  box = (await objects(page))[0] as never;
  expect(box.box.width).toBeCloseTo(150, 0);
  expect(box.box.height).toBeCloseTo(130, 0);
  // Rotate 90° with Shift snapping
  const r = (await page.locator('[data-handle="rotate"]').boundingBox())!;
  const cx = c.x + box.box.x + box.box.width / 2;
  const cy = c.y + box.box.y + box.box.height / 2;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(cx + 120, cy + 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  box = (await objects(page))[0] as never;
  expect(box.box.rotation).toBe(90);
  // Properties panel reflects the transform
  await expect(page.getByLabel('回転', { exact: true })).toHaveValue('90');
});

test('places an image and stacks vector objects over it', async ({ page }) => {
  const png = makePng(40, 30, (x) => (x < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /画像を配置/ }).click();
  await (await chooser).setFiles({ name: 'test.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('[data-testid=canvas] image')).toHaveCount(1);
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 380, y: c.y + 280 }, { x: c.x + 420, y: c.y + 320 });
  expect((await objects(page)).map((o) => o.type)).toEqual(['image', 'shape']);
  // Bring the image to front via menu.
  await page.keyboard.press('v');
  await page.locator('[data-object-row="test.png"]').click();
  await page.keyboard.press('Control+Shift+BracketRight');
  expect((await objects(page)).map((o) => o.type)).toEqual(['shape', 'image']);
});

test('rejects non-image files with an error', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /画像を配置/ }).click();
  await (await chooser).setFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not a png') });
  await expect(page.locator('.notice.error')).toContainText('bad.png');
  expect(await objects(page)).toHaveLength(0);
});

test('layers: add, hide, lock and reorder', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 50, y: c.y + 50 }, { x: c.x + 150, y: c.y + 150 });
  await page.getByRole('button', { name: '新規レイヤー' }).click();
  await expect(page.locator('[data-layer-row]')).toHaveCount(2);
  // Hide layer 1 → its rectangle disappears from the canvas.
  const row1 = page.locator('[data-layer-row="レイヤー 1"]');
  await row1.getByRole('button', { name: '非表示にする' }).click();
  await expect(page.locator('[data-testid=canvas] path')).toHaveCount(0);
  await row1.getByRole('button', { name: '表示する' }).click();
  await expect(page.locator('[data-testid=canvas] path')).toHaveCount(1);
  // Lock layer 1 → its object can no longer be selected or deleted.
  await row1.getByRole('button', { name: 'ロックする' }).click();
  await page.keyboard.press('v');
  await page.mouse.click(c.x + 100, c.y + 100);
  expect(await state<string[]>(page, 's => s.selection')).toEqual([]);
  // Lock state shown in the UI and drawing into a locked layer is refused.
  await row1.click();
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 300, y: c.y + 300 }, { x: c.x + 350, y: c.y + 350 });
  await expect(page.locator('.notice.error')).toContainText('ロック');
  // Reorder: drag layer 1 onto the upper half of layer 2's row (= above layer 2).
  await row1.dragTo(page.locator('[data-layer-row="レイヤー 2"]'), { targetPosition: { x: 40, y: 3 } });
  expect(await state<string[]>(page, 's => s.doc.layers.map(l => l.name)')).toEqual(['レイヤー 2', 'レイヤー 1']);
});

test('saves a project and reopens it for further editing', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 50, y: c.y + 50 }, { x: c.x + 150, y: c.y + 120 });
  const png = makePng(10, 10, () => [0, 200, 0, 255]);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+Shift+I');
  await (await chooser).setFiles({ name: 'green.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('[data-testid=canvas] image')).toHaveCount(1);
  await expect(page.locator('.dirty-mark')).toBeVisible();
  const before = await state<unknown>(page, 's => s.doc');

  const dl = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(/\.hnb$/);
  const path = await download.path();
  await expect(page.locator('.dirty-mark')).toHaveCount(0);

  // Start over, then open the saved file.
  await page.reload();
  const opener = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /開く/ }).click();
  await (await opener).setFiles({ name: 'project.hnb', mimeType: 'application/octet-stream', buffer: readFileSync(path!) });
  await expect(page.locator('[data-testid=canvas] image')).toHaveCount(1);
  expect(await state<unknown>(page, 's => s.doc')).toEqual(before);
  // Continue editing after reopening.
  await page.keyboard.press('v');
  await page.locator('[data-object-row="矩形"]').click();
  await page.keyboard.press('Delete');
  expect(await objects(page)).toHaveLength(1);
});

test('double-clicking a text object with the select tool edits it in place', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('t');
  await page.mouse.click(c.x + 100, c.y + 100);
  await expect(page.locator('textarea.text-editor')).toBeFocused();
  await page.keyboard.type('Before');
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const t = (await page.locator('[data-testid=canvas] text').boundingBox())!;
  await page.mouse.dblclick(t.x + t.width / 2, t.y + t.height / 2);
  // The editor takes focus on the next animation frame; wait for it before typing.
  await expect(page.locator('textarea.text-editor')).toBeFocused();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('After');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid=canvas] text')).toHaveText('After');
});

test('Shift+drag on a selected object moves the whole selection along one axis; Shift+click still toggles', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 150, y: c.y + 150 });
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 200, y: c.y + 100 }, { x: c.x + 250, y: c.y + 150 });
  await expect.poll(async () => (await objects(page)).length).toBe(2);
  await page.keyboard.press('v');
  await page.keyboard.press('Control+a');
  expect(await state<string[]>(page, 's => s.selection')).toHaveLength(2);
  await page.keyboard.down('Shift');
  await page.mouse.move(c.x + 125, c.y + 125);
  await page.mouse.down();
  await page.mouse.move(c.x + 185, c.y + 135, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  // Both stay selected and move horizontally only.
  expect(await state<string[]>(page, 's => s.selection')).toHaveLength(2);
  const boxes = (await objects(page)).map((o) => (o as unknown as { box: { x: number; y: number } }).box);
  expect(boxes.map((b) => [Math.round(b.x), Math.round(b.y)])).toEqual([
    [160, 100],
    [260, 100],
  ]);
  // A Shift+click without dragging takes the clicked one out of the selection, and adds it back.
  await page.keyboard.down('Shift');
  await page.mouse.click(c.x + 185, c.y + 125);
  expect(await state<string[]>(page, 's => s.selection')).toHaveLength(1);
  await page.mouse.click(c.x + 185, c.y + 125);
  await page.keyboard.up('Shift');
  expect(await state<string[]>(page, 's => s.selection')).toHaveLength(2);
});
