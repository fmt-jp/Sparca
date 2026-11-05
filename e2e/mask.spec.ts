// グラデーションマスク: added from the properties panel or the 変更 menu, checked in the exported PNG.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canvasBox, decodePixels, disableNativePickers, drag, setColor, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

const props = (page: Page) => page.getByRole('region', { name: 'プロパティ' });

async function exportPng(page: Page, points: [number, number][]) {
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByLabel('PNG', { exact: true }).check();
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  return (await decodePixels(page, readFileSync((await (await dl).path())!), 'image/png', points)).px;
}

/** A red rectangle at (100,100)–(400,300) on the white canvas. */
async function redRect(page: Page, x0 = 100, y0 = 100, x1 = 400, y1 = 300) {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + x0, y: c.y + y0 }, { x: c.x + x1, y: c.y + y1 });
  await setColor(page, props(page), '塗り', '#ff0000');
  return c;
}

const isRed = (p: number[]) => p[0] > 230 && p[1] < 30 && p[2] < 30;
const isWhite = (p: number[]) => p[0] > 245 && p[1] > 245 && p[2] > 245;
const isPink = (p: number[]) => p[0] > 230 && p[1] > 60 && p[1] < 200; // half faded red on white

const owner = (page: Page) => state<{ id: string; mask: { background: string; enabled: boolean; children: { type: string; fill: unknown }[] } | null }>(page, 's => { const o = s.doc.layers[0].children[0]; return { id: o.id, mask: o.mask ?? null }; }');

test('グラデーションマスク: fades the shape; editing the mask moves its gradient; off, view, remove', async ({ page }) => {
  const c = await redRect(page);
  await props(page).getByRole('button', { name: 'グラデーションマスクを追加' }).click();
  // A mask layer holding a gradient rectangle, and editing it starts.
  let o = await owner(page);
  expect(o.mask).toMatchObject({ background: 'black', enabled: true });
  expect(o.mask!.children).toHaveLength(1);
  await expect(page.getByTestId('mask-edit-panel')).toBeVisible();
  await expect(page.getByTestId('mask-edit-frame')).toBeVisible();
  await expect(page.locator('.mask-thumb.editing')).toHaveCount(1);
  // Its gradient rectangle is selected at once, so the colors can be changed right away.
  const rectId = await state<string>(page, 's => s.doc.layers[0].children[0].mask.children[0].id');
  expect(await state(page, 's => s.selection')).toEqual([rectId]);
  await expect(props(page).getByRole('button', { name: /^塗りの色1/ })).toBeVisible();
  await expect(props(page).getByRole('group', { name: 'マスクの中身' }).getByRole('button', { name: 'グラデーション' })).toHaveAttribute('aria-pressed', 'true');
  // White (shows) at 10 % of the width, black (hidden) at 90 %.
  let px = await exportPng(page, [[110, 200], [250, 200], [395, 200]]);
  expect(isRed(px[0])).toBe(true);
  expect(isPink(px[1])).toBe(true);
  expect(isWhite(px[2])).toBe(true);
  // Click the shape: the gradient rectangle of the mask is picked; turn its gradient around.
  await page.mouse.click(c.x + 250, c.y + 200);
  expect(await state(page, 's => s.selection')).toEqual([await state(page, 's => s.doc.layers[0].children[0].mask.children[0].id')]);
  await expect(page.getByTestId('gradient-handles')).toHaveAttribute('data-gradient-key', 'fill');
  const end = (await page.locator('[data-gradient-handle="end"]').boundingBox())!;
  await drag(page, { x: end.x + end.width / 2, y: end.y + end.height / 2 }, { x: c.x + 100, y: c.y + 200 });
  const start = (await page.locator('[data-gradient-handle="start"]').boundingBox())!;
  await drag(page, { x: start.x + start.width / 2, y: start.y + start.height / 2 }, { x: c.x + 400, y: c.y + 200 });
  px = await exportPng(page, [[105, 200], [395, 200]]);
  expect(isWhite(px[0])).toBe(true);
  expect(isRed(px[1])).toBe(true);
  // The mask itself in gray, and back.
  await props(page).getByLabel('マスクのみ（白黒）').check();
  await expect(page.locator(`[data-testid=canvas] g[data-mask-of="${o.id}"] filter`)).toHaveCount(1);
  await props(page).getByLabel('仕上がり').check();
  // Escape ends editing; the shape is selected again.
  await page.keyboard.press('Escape');
  expect(await state(page, 's => s.maskEdit')).toBeNull();
  expect(await state(page, 's => s.selection')).toEqual([o.id]);
  // Off: the whole shape shows again; the mask is kept.
  await props(page).getByLabel('マスクを使う').uncheck();
  px = await exportPng(page, [[105, 200], [395, 200]]);
  expect(isRed(px[0]) && isRed(px[1])).toBe(true);
  await props(page).getByLabel('マスクを使う').check();
  // Remove: back to the plain shape, in one undo step back.
  await props(page).getByRole('button', { name: 'マスクを削除' }).click();
  expect((await owner(page)).mask).toBeNull();
  await page.keyboard.press('Control+z');
  o = await owner(page);
  expect(o.mask!.children).toHaveLength(1);
});

test('a black mask hides all; a white shape drawn while editing shows through it', async ({ page }) => {
  const c = await redRect(page);
  await props(page).getByRole('button', { name: 'マスクを追加（黒）' }).click();
  let px = await exportPng(page, [[250, 200]]);
  expect(isWhite(px[0])).toBe(true); // all hidden
  // Draw an ellipse while editing: it goes into the mask; make it white.
  await page.keyboard.press('r');
  await page.keyboard.press('r');
  await page.keyboard.press('r'); // 矩形 → 角丸矩形 → 楕円
  await drag(page, { x: c.x + 150, y: c.y + 150 }, { x: c.x + 250, y: c.y + 250 });
  // The content list selects it too.
  await page.keyboard.press('v');
  await page.mouse.click(c.x + 600, c.y + 500); // empty: nothing selected, still editing
  expect(await state(page, 's => s.selection')).toEqual([]);
  await props(page).getByRole('group', { name: 'マスクの中身' }).getByRole('button').first().click();
  expect(await state(page, 's => s.selection.length')).toBe(1);
  // It stays selected through edits, so its color can be changed again and again.
  await setColor(page, props(page), '塗り', '#808080');
  const ellipseId = await state<string>(page, 's => s.doc.layers[0].children[0].mask.children[0].id');
  expect(await state(page, 's => s.selection')).toEqual([ellipseId]);
  await setColor(page, props(page), '塗り', '#ffffff');
  expect(await state(page, 's => s.selection')).toEqual([ellipseId]);
  expect(await state(page, 's => s.doc.layers[0].children[0].mask.children[0].fill')).toBe('#ffffff');
  const o = await owner(page);
  expect(o.mask!.children.map((k) => k.type)).toEqual(['shape']);
  expect(await state(page, 's => s.doc.layers[0].children.length')).toBe(1); // not on the layer
  px = await exportPng(page, [[200, 200], [350, 200], [155, 155]]);
  expect(isRed(px[0])).toBe(true); // inside the ellipse
  expect(isWhite(px[1])).toBe(true); // outside
  expect(isWhite(px[2])).toBe(true); // in its box but outside the ellipse
  // The layers panel's mask thumbnail ends and starts editing.
  await page.locator('.mask-thumb').click();
  expect(await state(page, 's => s.maskEdit')).toBeNull();
  await page.locator('.mask-thumb').click();
  expect(await state(page, 's => s.maskEdit')).toBe(o.id);
});

test('the mask moves with the shape', async ({ page }) => {
  const c = await redRect(page);
  await props(page).getByRole('button', { name: 'グラデーションマスクを追加' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await drag(page, { x: c.x + 200, y: c.y + 200 }, { x: c.x + 300, y: c.y + 250 }); // move by (100, 50)
  const px = await exportPng(page, [[210, 250], [495, 250]]);
  expect(isRed(px[0])).toBe(true);
  expect(isWhite(px[1])).toBe(true);
});

test('a group gets a mask from the 変更 menu that covers all its members', async ({ page }) => {
  await redRect(page, 100, 100, 250, 300);
  await redRect(page, 250, 100, 400, 300);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await page.getByRole('menuitem', { name: 'グラデーションマスクを追加' }).click();
  expect(await state(page, 's => s.doc.layers[0].children[0].type')).toBe('group');
  expect(await state(page, 's => s.doc.layers[0].children[0].mask.children.length')).toBe(1);
  const px = await exportPng(page, [[110, 200], [395, 200]]);
  expect(isRed(px[0])).toBe(true); // left member shows
  expect(isWhite(px[1])).toBe(true); // right member faded out
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'グラデーションマスクを追加' })).toBeDisabled();
});
