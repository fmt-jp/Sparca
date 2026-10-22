import { expect, test, type Page } from '@playwright/test';
import { canvasBox, drag, makePng, state } from './helpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

type Obj = { type: string; name: string; box: { x: number; y: number; width: number; height: number } };
const objects = (page: Page) => state<Obj[]>(page, 's => s.doc.layers[0].children');

/** Put a PNG on the system clipboard, as a screenshot tool (Windows+Shift+S) does. */
async function screenshotToClipboard(page: Page, png: Buffer) {
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bin], { type: 'image/png' }) })]);
  }, png.toString('base64'));
}

const RED = makePng(120, 80, () => [255, 0, 0, 255]);

test('Ctrl+V pastes an image from the system clipboard onto the canvas, centered and selected', async ({ page }) => {
  await screenshotToClipboard(page, RED);
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  const [img] = await objects(page);
  expect(img.type).toBe('image');
  expect(img.name).toBe('クリップボードの画像.png');
  expect(img.box).toMatchObject({ x: 340, y: 260, width: 120, height: 80 }); // center of 800×600
  expect(await state<string[]>(page, 's => s.selection')).toHaveLength(1);
  // One undo step removes it.
  await page.keyboard.press('Control+z');
  expect(await objects(page)).toHaveLength(0);
});

test('objects copied in HANABI paste as objects until something newer is copied elsewhere', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 200, y: c.y + 200 });
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  expect((await objects(page)).map((o) => o.type)).toEqual(['shape', 'shape']);

  // A screenshot taken afterwards replaces the clipboard: Ctrl+V now pastes the image.
  await screenshotToClipboard(page, RED);
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await objects(page)).map((o) => o.type)).toEqual(['shape', 'shape', 'image']);

  // Copying in HANABI again takes over.
  await page.keyboard.press('Control+c'); // the pasted image is selected
  await page.keyboard.press('Control+v');
  expect((await objects(page)).map((o) => o.type)).toEqual(['shape', 'shape', 'image', 'image']);
  expect(await state<number>(page, 's => Object.keys(s.doc.assets).length')).toBe(1); // same image data reused
});

test('ペースト in the menus also places a clipboard image', async ({ page }) => {
  await screenshotToClipboard(page, RED);
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.getByRole('menuitem', { name: /^ペースト/ }).click();
  await expect.poll(async () => (await objects(page)).map((o) => o.type)).toEqual(['image']);

  const c = await canvasBox(page);
  await page.mouse.click(c.x + 700, c.y + 550, { button: 'right' });
  await page.getByRole('menu', { name: 'キャンバスのメニュー' }).getByRole('menuitem', { name: /^ペースト/ }).click();
  await expect.poll(async () => (await objects(page)).length).toBe(2);
});

test('menu コピー then ペースト keeps working for objects', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 200, y: c.y + 200 });
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.getByRole('menuitem', { name: /^コピー/ }).click();
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.getByRole('menuitem', { name: /^ペースト/ }).click();
  await expect.poll(async () => (await objects(page)).map((o) => o.type)).toEqual(['shape', 'shape']);
});

test('text fields keep normal copy and paste', async ({ page }) => {
  await page.evaluate(() => navigator.clipboard.writeText('123'));
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 200, y: c.y + 200 });
  const w = page.getByRole('region', { name: 'プロパティ' }).locator('input[aria-label="幅"]');
  await w.fill('');
  await w.focus();
  await page.keyboard.press('Control+v');
  await expect(w).toHaveValue('123');
  expect(await objects(page)).toHaveLength(1);
});
