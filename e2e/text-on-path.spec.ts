// テキストをパスに添付: text and a path (or shape) become one text that runs along the path.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canvasBox, decodePixels, disableNativePickers, drag, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

type Obj = { id: string; type: string; text?: string; path?: { offset: number; orientation: string; reverse: boolean; shift: number } };
const objects = (page: Page) => state<Obj[]>(page, 's => s.doc.layers[0].children');
const setTool = (page: Page, tool: string) =>
  page.evaluate((t) => (window as unknown as { __sparca: { setTool(t: string): void } }).__sparca.setTool(t), tool);
const glyphs = (page: Page) => page.locator('[data-testid=canvas] [data-text-on-path] text');

async function setup(page: Page) {
  const c = await canvasBox(page);
  await setTool(page, 'ellipse');
  await drag(page, { x: c.x + 200, y: c.y + 150 }, { x: c.x + 400, y: c.y + 350 });
  await setTool(page, 'text');
  await page.mouse.click(c.x + 500, c.y + 450);
  await page.keyboard.type('HANABI');
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.keyboard.press('Control+a');
  return c;
}

test('Ctrl+Shift+Y puts the text on the circle; settings change the layout; パスから外す restores both', async ({ page }) => {
  await setup(page);
  await page.keyboard.press('Control+Shift+Y');
  let objs = await objects(page);
  expect(objs).toHaveLength(1);
  expect(objs[0]).toMatchObject({ type: 'text', text: 'HANABI', path: { offset: 0, orientation: 'rotate', reverse: false, shift: 0 } });
  await expect(glyphs(page)).toHaveCount(6);
  await expect(glyphs(page).first()).toHaveAttribute('transform', /rotate\(/);
  const panel = page.getByRole('group', { name: 'パス上のテキスト' });
  await expect(panel).toBeVisible();

  // Orientation, reverse, start position and distance.
  await panel.getByLabel('方向', { exact: true }).selectOption('vertical');
  await expect(glyphs(page).first()).not.toHaveAttribute('transform', /rotate|skew/);
  await panel.getByLabel('方向', { exact: true }).selectOption('skew-horizontal');
  await expect(glyphs(page).first()).toHaveAttribute('transform', /skewX/);
  await panel.getByLabel('逆方向（パスの反対側）').check();
  for (const [label, v] of [['開始位置', '25'], ['パスからの距離', '8']]) {
    const i = panel.locator(`input[type="text"][aria-label="${label}"]`);
    await i.fill(v);
    await i.press('Enter');
  }
  objs = await objects(page);
  expect(objs[0].path).toMatchObject({ orientation: 'skew-horizontal', reverse: true, offset: 0.25, shift: 8 });

  // Double-click edits it in the properties panel (not in place).
  const g = (await glyphs(page).nth(2).boundingBox())!;
  await page.mouse.dblclick(g.x + g.width / 2, g.y + g.height / 2);
  await expect(page.locator('textarea[aria-label="テキスト内容"]')).toBeFocused();
  await page.locator('textarea[aria-label="テキスト内容"]').fill('HANABI 2026');
  await expect(glyphs(page)).toHaveCount(10);

  // Detach: the circle comes back as a path under the text.
  await panel.getByRole('button', { name: 'パスから外す' }).click();
  objs = await objects(page);
  expect(objs.map((o) => o.type)).toEqual(['path', 'text']);
  expect(objs[1].path).toBeUndefined();
  await expect(glyphs(page)).toHaveCount(0);
  // Undo twice: attached again, with the earlier settings.
  await page.keyboard.press('Control+z');
  expect((await objects(page))[0].path).toMatchObject({ orientation: 'skew-horizontal' });
});

test('the 変更 menu and right-click attach; the letters are exported', async ({ page }) => {
  const c = await setup(page);
  await page.mouse.click(c.x + 300, c.y + 250, { button: 'right' });
  await page.getByRole('menuitem', { name: 'テキストをパスに添付' }).click();
  expect((await objects(page))[0].type).toBe('text');
  // Exported PNG has the letters along the top of the circle (no circle outline drawn).
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  const bytes = readFileSync((await (await dl).path())!);
  const pts: [number, number][] = [];
  for (let x = 200; x <= 400; x += 2) for (let y = 120; y <= 180; y += 2) pts.push([x, y]);
  const px = (await decodePixels(page, bytes, 'image/png', pts)).px;
  expect(px.filter((p) => p[0] < 128).length).toBeGreaterThan(20);
  // Menu: detach is enabled for it.
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'テキストをパスから外す' })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'テキストをパスから外す' }).click();
  expect((await objects(page)).map((o) => o.type)).toEqual(['path', 'text']);
});
