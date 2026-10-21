import { expect, test, type Page } from '@playwright/test';
import { addEffect, canvasBox, drag, makePng, state } from './helpers';

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

test.describe('every shape tool uses the same ▾ slider for its numbers', () => {
  const tools: { tool: string; menu: string; extra: string[] }[] = [
    { tool: 'rect', menu: '矩形ツール', extra: ['角丸'] },
    { tool: 'rounded-rect', menu: '角丸矩形ツール', extra: ['角丸'] },
    { tool: 'ellipse', menu: '楕円ツール', extra: [] },
    { tool: 'polygon', menu: '多角形ツール', extra: ['頂点数'] },
    { tool: 'star', menu: '星ツール', extra: ['頂点数'] },
    { tool: 'arrow', menu: '矢印ツール', extra: [] },
  ];
  for (const t of tools) {
    test(`${t.menu}: 線幅${t.extra.map((x) => `・${x}`).join('')}`, async ({ page }) => {
      await page.keyboard.press('Control+z'); // drop the polygon from beforeEach
      const c = await canvasBox(page);
      // R cycles through the shape group.
      for (let i = 0; i < 6 && (await state<string>(page, 's => s.tool')) !== t.tool; i++) await page.keyboard.press('r');
      expect(await state<string>(page, 's => s.tool')).toBe(t.tool);
      await drag(page, { x: c.x + 300, y: c.y + 150 }, { x: c.x + 500, y: c.y + 350 });
      const props = page.getByRole('region', { name: 'プロパティ' });
      const obj = () => state<{ strokeWidth: number; shape: Record<string, number> }>(page, 's => s.doc.layers[0].children[0]');
      const before = await obj();

      for (const label of ['線幅', ...t.extra]) {
        await props.getByRole('button', { name: `${label}のスライダー` }).click();
        const slider = page.getByRole('slider', { name: label });
        await expect(slider).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Escape');
        await expect(slider).toHaveCount(0);
      }
      const after = await obj();
      expect(after.strokeWidth).toBe(before.strokeWidth + 2);
      if (t.extra.includes('角丸')) expect(after.shape.cornerRadius).toBe(before.shape.cornerRadius + 2);
      if (t.tool === 'polygon') expect(after.shape.sides).toBe(before.shape.sides + 2);
      if (t.tool === 'star') expect(after.shape.points).toBe(before.shape.points + 2);
    });
  }

  test('the stroke width slider goes to 50px while the box accepts more; the corner slider stops at half the shorter side', async ({ page }) => {
    await page.keyboard.press('Control+z');
    const c = await canvasBox(page);
    await page.keyboard.press('r');
    await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 300, y: c.y + 180 }); // 200×80
    const props = page.getByRole('region', { name: 'プロパティ' });
    await props.getByRole('button', { name: '線幅のスライダー' }).click();
    await page.keyboard.press('End');
    expect(await state<number>(page, 's => s.doc.layers[0].children[0].strokeWidth')).toBe(50);
    await page.keyboard.press('Escape');
    const box = props.locator('input[aria-label="線幅"]');
    await box.fill('120');
    await box.press('Enter');
    expect(await state<number>(page, 's => s.doc.layers[0].children[0].strokeWidth')).toBe(120);
    await props.getByRole('button', { name: '角丸のスライダー' }).click();
    await expect(page.getByRole('slider', { name: '角丸' })).toHaveAttribute('aria-valuemax', '40');
  });
});

test.describe('the properties panel uses only pop-up sliders', () => {
  test('no inline range sliders remain; opacity, effects and image adjustments open the ▾ slider', async ({ page }) => {
    const props = page.getByRole('region', { name: 'プロパティ' });
    // Polygon from beforeEach is selected: opacity + effects.
    await addEffect(page, 'シャドウとグロー', 'ドロップシャドウ');
    await addEffect(page, 'シャドウとグロー', 'グロー');
    await expect(props.locator('input[type="range"]')).toHaveCount(0);

    const obj = () => state<{ opacity: number; effects: { distance: number }[] }>(page, 's => s.doc.layers[0].children[0]');
    await props.getByRole('button', { name: '不透明度のスライダー', exact: true }).click();
    await page.keyboard.press('Home'); // 0%
    await page.keyboard.press('Escape');
    expect((await obj()).opacity).toBe(0);
    await props.getByRole('button', { name: 'ドロップシャドウの距離のスライダー', exact: true }).click();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Escape');
    expect((await obj()).effects[0].distance).toBe(7); // default 6 + 1

    // Image adjustments use it too.
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Control+Shift+I');
    await (await chooser).setFiles({ name: 'g.png', mimeType: 'image/png', buffer: makePng(8, 8, () => [100, 100, 100, 255]) });
    await page.waitForFunction(() => (window as never as { __sparca: { getState(): { selection: string[] } } }).__sparca.getState().selection.length === 1);
    await expect(props.locator('input[type="range"]')).toHaveCount(0);
    await props.getByRole('button', { name: '明るさのスライダー', exact: true }).click();
    await page.keyboard.press('PageUp'); // +20 (a tenth of −100..100)
    await page.keyboard.press('Escape');
    expect(await state<number>(page, 's => s.doc.layers[0].children[0].pipeline.adjust.brightness')).toBe(20);
  });
});
