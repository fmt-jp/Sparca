import { expect, test, type Page } from '@playwright/test';
import { canvasBox, drag, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 300, y: c.y + 300 });
});

const shape = (page: Page) => state<{ fill: string | null; stroke: string | null; strokeWidth: number }>(page, 's => s.doc.layers[0].children[0]');
const props = (page: Page) => page.getByRole('region', { name: 'プロパティ' });

test('clicking the swatch opens a palette of basic and 216 web colors; clicking a color applies it', async ({ page }) => {
  await props(page).getByRole('button', { name: '塗り', exact: true }).click();
  const pal = page.getByRole('dialog', { name: '塗りのパレット' });
  await expect(pal).toBeVisible();
  await expect(pal.locator('.palette-grid .palette-cell')).toHaveCount(216);
  await expect(pal.locator('.palette-basic .palette-cell')).toHaveCount(12);
  // Hovering shows the code in the field (like Fireworks).
  await pal.getByRole('button', { name: '#ff6600', exact: true }).hover();
  await expect(pal.getByLabel('塗りのカラーコード')).toHaveValue('#FF6600');
  await pal.getByRole('button', { name: '#ff6600', exact: true }).click();
  await expect(pal).toHaveCount(0);
  expect((await shape(page)).fill).toBe('#ff6600');
  await expect(props(page).getByRole('button', { name: '塗り', exact: true })).toHaveAttribute('data-color', '#ff6600');
  // One undo step.
  await page.keyboard.press('Control+z');
  expect((await shape(page)).fill).toBe('#4a90e2');
});

test('typing a code, choosing "none", and closing with Esc or an outside click', async ({ page }) => {
  // Stroke: type a code (short form works too).
  await props(page).getByRole('button', { name: '線', exact: true }).click();
  const code = page.getByLabel('線のカラーコード');
  await expect(code).toBeFocused();
  await code.fill('#c8c8c8');
  await code.press('Enter');
  const s = await shape(page);
  expect(s.stroke).toBe('#c8c8c8');
  expect(s.strokeWidth).toBeGreaterThan(0); // a visible stroke is given a width
  // Invalid codes are not applied.
  await props(page).getByRole('button', { name: '線', exact: true }).click();
  await code.fill('#12');
  await code.press('Enter');
  await expect(code).toHaveClass(/invalid/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '線のパレット' })).toHaveCount(0);
  expect((await shape(page)).stroke).toBe('#c8c8c8');
  // "None" (red slash) removes the fill.
  await props(page).getByRole('button', { name: '塗り', exact: true }).click();
  await page.getByRole('button', { name: '塗りなし' }).click();
  expect((await shape(page)).fill).toBeNull();
  await expect(props(page).getByRole('button', { name: '塗り', exact: true })).toHaveAttribute('data-color', 'none');
  // Outside click closes without changing anything.
  await props(page).getByRole('button', { name: '塗り', exact: true }).click();
  await page.mouse.click(700, 120);
  await expect(page.getByRole('dialog', { name: '塗りのパレット' })).toHaveCount(0);
  expect((await shape(page)).fill).toBeNull();
});

test('the same palette is used for text color, effects and the background', async ({ page }) => {
  // Background (nothing selected).
  await page.keyboard.press('Escape');
  await props(page).getByRole('button', { name: '背景色', exact: true }).click();
  await page.getByRole('dialog', { name: '背景色のパレット' }).getByRole('button', { name: '#ffff00', exact: true }).first().click(); // also in the basic column
  expect(await state<unknown>(page, 's => s.doc.background')).toEqual({ kind: 'color', color: '#ffff00' });
  // Drop shadow color on the rectangle.
  await page.locator('[data-object-row="矩形"]').click();
  await page.getByLabel('ドロップシャドウ', { exact: true }).check();
  await props(page).getByRole('button', { name: '影の色', exact: true }).click();
  await page.getByRole('dialog', { name: '影の色のパレット' }).getByRole('button', { name: '#0000ff', exact: true }).first().click();
  expect(await state<string>(page, 's => s.doc.layers[0].children[0].effects.dropShadow.color')).toBe('#0000ff');
});
