import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canvasBox, decodePixels, disableNativePickers, drag, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

type Arrow = {
  shape: { kind: string; shaft: number; head: number };
  fill: string;
  stroke: string;
  strokeWidth: number;
  box: { x: number; y: number; width: number; height: number; rotation: number };
};
const arrow = (page: Page) => state<Arrow>(page, 's => s.doc.layers[0].children[0]');

async function selectArrowTool(page: Page) {
  await page.locator('[data-tool="rect"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '矢印ツール' }).click();
}

async function setNumber(page: Page, label: string, value: string) {
  const input = page.getByRole('region', { name: 'プロパティ' }).locator(`input[type="text"][aria-label="${label}"]`);
  await input.fill(value);
  await input.press('Enter');
}

test('draws a filled, outlined block arrow pointing along the drag', async ({ page }) => {
  const c = await canvasBox(page);
  await selectArrowTool(page);
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 300, y: c.y + 300 }); // down-right
  const a = await arrow(page);
  expect(a.shape).toMatchObject({ kind: 'block-arrow' });
  expect(a).toMatchObject({ fill: '#ffe100', stroke: '#000000', strokeWidth: 4 });
  expect(a.box.rotation).toBeCloseTo(45, 1);
  expect(a.box.width).toBeCloseTo(Math.hypot(200, 200), 0);
  // Fill and outline are edited like any other shape.
  const props = page.getByRole('region', { name: 'プロパティ' });
  await expect(props.getByLabel('塗り', { exact: true })).toHaveValue('#ffe100');
  await props.getByLabel('塗り', { exact: true }).fill('#ff0000');
  await setNumber(page, '線幅', '8');
  expect(await arrow(page)).toMatchObject({ fill: '#ff0000', strokeWidth: 8 });
});

test('shaft thickness, head length, tip angle and direction are adjustable', async ({ page }) => {
  const c = await canvasBox(page);
  await selectArrowTool(page);
  await drag(page, { x: c.x + 100, y: c.y + 200 }, { x: c.x + 300, y: c.y + 200 }); // 200px to the right
  await setNumber(page, '軸の太さ', '30');
  await setNumber(page, '矢じりの長さ', '25');
  let a = await arrow(page);
  expect(a.shape.shaft).toBeCloseTo(0.3);
  expect(a.shape.head).toBeCloseTo(0.25);
  // Tip angle 90° → head length = half the head width.
  await setNumber(page, '先端の角度', '90');
  a = await arrow(page);
  expect(a.shape.head * a.box.width).toBeCloseTo(a.box.height / 2, 0);
  await expect(page.locator('input[type="text"][aria-label="先端の角度"]')).toHaveValue('90');
  // Direction: pointing up.
  await setNumber(page, '回転', '-90');
  expect((await arrow(page)).box.rotation).toBe(-90);
  // Undo the direction change.
  await page.keyboard.press('Control+z');
  expect((await arrow(page)).box.rotation).toBe(0);
});

test('exports as a yellow arrow with a black outline', async ({ page }) => {
  const c = await canvasBox(page);
  await selectArrowTool(page);
  await drag(page, { x: c.x + 100, y: c.y + 200 }, { x: c.x + 500, y: c.y + 200 }); // 400 long, 220 high
  await page.keyboard.press('Control+Shift+E');
  const dl = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: '書き出し' }).click();
  const bytes = readFileSync((await (await dl).path())!);
  const px = await decodePixels(page, bytes, 'image/png', [
    [200, 200], // inside the shaft
    [101, 200], // on the tail outline
    [480, 200], // inside the head near the tip
    [200, 120], // above the shaft (white background)
  ]);
  expect(px.px[0].slice(0, 3)).toEqual([255, 225, 0]);
  expect(px.px[1].slice(0, 3).every((v) => v < 60)).toBe(true);
  expect(px.px[2][0]).toBeGreaterThan(200);
  expect(px.px[2][2]).toBeLessThan(60);
  expect(px.px[3].slice(0, 3)).toEqual([255, 255, 255]);
});
