import { expect, test, type Page } from '@playwright/test';
import { canvasBox, drag, state } from './helpers';

const sides = (page: Page) => state<number>(page, 's => s.doc.layers[0].children[0].shape.sides');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const c = await canvasBox(page);
  await page.locator('[data-tool="rect"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '多角形ツール' }).click();
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 300, y: c.y + 300 });
  expect(await sides(page)).toBe(6);
});

test('the ▾ button next to 頂点数 opens a vertical slider that changes the polygon live', async ({ page }) => {
  const props = page.getByRole('region', { name: 'プロパティ' });
  await props.getByRole('button', { name: '頂点数のスライダー' }).click();
  const slider = page.getByRole('slider', { name: '頂点数' });
  await expect(slider).toBeVisible();
  await expect(slider).toHaveAttribute('aria-orientation', 'vertical');

  // Drag the thumb to the top → maximum; to the bottom → minimum.
  const track = (await page.locator('.vslider-track').boundingBox())!;
  const x = track.x + track.width / 2;
  await page.mouse.move(x, track.y + track.height - 5);
  await page.mouse.down();
  await page.mouse.move(x, track.y - 20, { steps: 8 });
  expect(await sides(page)).toBe(64);
  await page.mouse.move(x, track.y + track.height / 2, { steps: 4 });
  const mid = await sides(page);
  expect(mid).toBeGreaterThan(30);
  expect(mid).toBeLessThan(37);
  await page.mouse.move(x, track.y + track.height + 30, { steps: 8 });
  await page.mouse.up();
  expect(await sides(page)).toBe(3);
  // The number box shows the slider's value.
  await expect(props.locator('input[aria-label="頂点数"]')).toHaveValue('3');

  // One drag = one undo step.
  await page.keyboard.press('Escape');
  await expect(slider).toHaveCount(0);
  await page.keyboard.press('Control+z');
  expect(await sides(page)).toBe(6);
});

test('arrow keys adjust the slider; clicking elsewhere closes it; typing still works', async ({ page }) => {
  const props = page.getByRole('region', { name: 'プロパティ' });
  await props.getByRole('button', { name: '頂点数のスライダー' }).click();
  const slider = page.getByRole('slider', { name: '頂点数' });
  await expect(slider).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  expect(await sides(page)).toBe(8);
  await page.keyboard.press('ArrowDown');
  expect(await sides(page)).toBe(7);
  await expect(slider).toHaveAttribute('aria-valuenow', '7');
  // Clicking outside closes it.
  await page.mouse.click(10, 300);
  await expect(slider).toHaveCount(0);
  // Typing in the box still works.
  const box = props.locator('input[aria-label="頂点数"]');
  await box.fill('12');
  await box.press('Enter');
  expect(await sides(page)).toBe(12);
});
