// 変更 → パスに変換: shapes become paths that look the same and can be reshaped point by point.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addEffect, canvasBox, disableNativePickers, drag, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

type Obj = { id: string; type: string; name: string; box: { x: number; y: number; width: number; height: number }; nodes?: { anchor: { x: number; y: number } }[] };
const objects = (page: Page) => state<Obj[]>(page, 's => s.doc.layers[0].children');

const setTool = (page: Page, tool: string) =>
  page.evaluate((t) => (window as unknown as { __sparca: { setTool(t: string): void } }).__sparca.setTool(t), tool);

async function exportPng(page: Page): Promise<string> {
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByLabel('PNG', { exact: true }).check();
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  return readFileSync((await (await dl).path())!).toString('base64');
}

/** Share of pixels that differ by more than a small anti-aliasing tolerance. */
function diffShare(page: Page, a: string, b: string) {
  return page.evaluate(async ([a, b]) => {
    const load = async (s: string) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(s), (c) => c.charCodeAt(0))], { type: 'image/png' }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    };
    const [p, q] = await Promise.all([load(a), load(b)]);
    let diff = 0;
    for (let i = 0; i < p.length; i += 4) {
      if (Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2]), Math.abs(p[i + 3] - q[i + 3])) > 48) diff++;
    }
    return diff / (p.length / 4);
  }, [a, b]);
}

test('変更 → パスに変換 keeps the look, keeps the selection, and is one undo step', async ({ page }) => {
  const c = await canvasBox(page);
  // Rounded rectangle with a dashed stroke and a drop shadow; a star; an ellipse.
  await page.keyboard.press('r');
  await page.keyboard.press('r');
  expect(await state<string>(page, 's => s.tool')).toBe('rounded-rect');
  await drag(page, { x: c.x + 40, y: c.y + 40 }, { x: c.x + 240, y: c.y + 160 });
  await addEffect(page, 'シャドウとグロー', 'ドロップシャドウ');
  await setTool(page, 'star');
  await drag(page, { x: c.x + 300, y: c.y + 40 }, { x: c.x + 420, y: c.y + 160 });
  await setTool(page, 'ellipse');
  await drag(page, { x: c.x + 460, y: c.y + 40 }, { x: c.x + 620, y: c.y + 160 });
  const before = await exportPng(page);
  const ids = (await objects(page)).map((o) => o.id);

  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await page.getByRole('menuitem', { name: 'パスに変換' }).click();
  const after = await objects(page);
  expect(after.map((o) => o.type)).toEqual(['path', 'path', 'path']);
  expect(after.map((o) => o.id)).toEqual(ids);
  expect(after.map((o) => o.nodes!.length)).toEqual([8, 10, 4]);
  expect(await state<string[]>(page, 's => s.selection')).toEqual(ids);
  expect(await state<string>(page, 's => s.history.past.at(-1).label')).toBe('パスに変換');
  // Looks the same when exported.
  expect(await diffShare(page, before, await exportPng(page))).toBeLessThan(0.002);
  // Nothing left to convert → disabled.
  await page.getByRole('button', { name: '変更', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'パスに変換' })).toBeDisabled();
  await page.keyboard.press('Escape');
  // One undo brings all three shapes back.
  await page.keyboard.press('Control+z');
  expect((await objects(page)).map((o) => o.type)).toEqual(['shape', 'shape', 'shape']);
});

test('a converted rectangle can be reshaped with the subselect tool (right-click → パスに変換)', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 300, y: c.y + 200 });
  await page.mouse.click(c.x + 200, c.y + 150, { button: 'right' });
  await page.getByRole('menuitem', { name: 'パスに変換' }).click();
  expect((await objects(page))[0].type).toBe('path');
  // Drag the top-right corner 60 px to the right → a trapezoid-like shape.
  await page.keyboard.press('a');
  const node = page.locator('[data-node="1"]');
  await expect(node).toBeVisible();
  const b = (await node.boundingBox())!;
  await drag(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, { x: c.x + 360, y: c.y + 100 });
  const pts = await state<{ x: number; y: number }[]>(
    page,
    's => { const o = s.doc.layers[0].children[0]; return o.nodes.map(n => ({ x: o.box.x + n.anchor.x * o.box.width, y: o.box.y + n.anchor.y * o.box.height })); }',
  );
  expect(pts[0].x).toBeCloseTo(100, 0);
  expect(pts[1].x).toBeCloseTo(360, 0);
  expect(pts[2].x).toBeCloseTo(300, 0);
});
