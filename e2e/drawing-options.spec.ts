import { expect, test, type Page } from '@playwright/test';
import { canvasBox, disableNativePickers, drag, setColor, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

type Obj = {
  id: string;
  type: string;
  name: string;
  box: { x: number; y: number; width: number; height: number };
  stroke?: string | null;
  strokeWidth?: number;
  strokeStyle?: string;
  fill?: unknown;
  fontSize?: number;
  bold?: boolean;
  nodes?: { anchor: { x: number; y: number } }[];
};
const objects = (page: Page) => state<Obj[]>(page, 's => s.doc.layers[0].children');

async function setNumber(scope: import('@playwright/test').Locator, label: string, value: string) {
  const input = scope.locator(`input[type="text"][aria-label="${label}"]`);
  await input.fill(value);
  await input.press('Enter');
}

test('Ctrl+drag (or Alt+drag) duplicates the selection and moves the copy', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 200, y: c.y + 200 });
  const [orig] = await objects(page);
  await page.keyboard.down('Control');
  await drag(page, { x: c.x + 150, y: c.y + 150 }, { x: c.x + 250, y: c.y + 150 });
  await page.keyboard.up('Control');
  let objs = await objects(page);
  expect(objs).toHaveLength(2);
  expect(objs[0]).toMatchObject({ id: orig.id, box: orig.box });
  expect(objs[1].id).not.toBe(orig.id);
  expect(objs[1].box.x).toBeCloseTo(orig.box.x + 100, 0);
  expect(objs[1].box.y).toBeCloseTo(orig.box.y, 0);
  expect(await state<string[]>(page, 's => s.selection')).toEqual([objs[1].id]);
  expect(await state<string>(page, 's => s.history.past.at(-1).label')).toBe('複製');
  // One undo removes the copy.
  await page.keyboard.press('Control+z');
  expect(await objects(page)).toHaveLength(1);
  // Alt+drag works the same; a plain drag just moves.
  await page.keyboard.down('Alt');
  await drag(page, { x: c.x + 150, y: c.y + 150 }, { x: c.x + 150, y: c.y + 250 });
  await page.keyboard.up('Alt');
  expect(await objects(page)).toHaveLength(2);
  await drag(page, { x: c.x + 150, y: c.y + 250 }, { x: c.x + 170, y: c.y + 250 });
  objs = await objects(page);
  expect(objs).toHaveLength(2);
  expect(objs[1].box.x).toBeCloseTo(orig.box.x + 20, 0);
});

test('Ctrl / Alt pressed during a drag switches to duplicating; releasing it switches back', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 200, y: c.y + 200 });
  const [orig] = await objects(page);
  // Start a plain drag, then press Ctrl part-way: a copy appears and the original goes back.
  await page.mouse.move(c.x + 150, c.y + 150);
  await page.mouse.down();
  await page.mouse.move(c.x + 200, c.y + 150, { steps: 4 });
  expect((await objects(page))[0].box.x).toBeCloseTo(orig.box.x + 50, 0);
  await page.keyboard.down('Control');
  // Without moving the pointer, the copy is already there.
  await expect.poll(async () => (await objects(page)).length).toBe(2);
  expect((await objects(page))[0].box).toMatchObject(orig.box);
  await page.mouse.move(c.x + 250, c.y + 150, { steps: 4 });
  let objs = await objects(page);
  expect(objs[1].box.x).toBeCloseTo(orig.box.x + 100, 0);
  // Release Ctrl before letting go: back to a plain move of the original.
  await page.keyboard.up('Control');
  await expect.poll(async () => (await objects(page)).length).toBe(1);
  expect((await objects(page))[0].box.x).toBeCloseTo(orig.box.x + 100, 0);
  // …and press it again (Alt this time) and let go: duplicated.
  await page.keyboard.down('Alt');
  await page.mouse.move(c.x + 260, c.y + 160, { steps: 2 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  objs = await objects(page);
  expect(objs).toHaveLength(2);
  expect(objs[0]).toMatchObject({ id: orig.id, box: orig.box });
  expect(objs[1].box.x).toBeCloseTo(orig.box.x + 110, 0);
  expect(objs[1].box.y).toBeCloseTo(orig.box.y + 10, 0);
  expect(await state<string>(page, 's => s.history.past.at(-1).label')).toBe('複製');
  await page.keyboard.press('Control+z');
  expect(await objects(page)).toHaveLength(1);
  expect((await objects(page))[0].box).toMatchObject(orig.box);
});

test('drawing tools have settings for new objects (color, width, line style, font), remembered by the browser', async ({ page }) => {
  const c = await canvasBox(page);
  // Shapes.
  await page.keyboard.press('r');
  const shapeSettings = page.getByRole('group', { name: '新しい図形の設定' });
  await expect(shapeSettings).toBeVisible();
  await setColor(page, shapeSettings, '塗り', '#00aa00');
  await setColor(page, shapeSettings, '線', '#ff0000');
  await setNumber(shapeSettings, '線幅', '5');
  await shapeSettings.getByLabel('線種').selectOption('dashed');
  await drag(page, { x: c.x + 50, y: c.y + 50 }, { x: c.x + 150, y: c.y + 150 });
  let o = (await objects(page))[0];
  expect(o).toMatchObject({ type: 'shape', fill: '#00aa00', stroke: '#ff0000', strokeWidth: 5, strokeStyle: 'dashed' });
  await expect(page.locator(`[data-object-id="${o.id}"] path[stroke-dasharray]`)).toHaveCount(1);
  // The shape's own panel has the line style too.
  await page.getByRole('region', { name: 'プロパティ' }).getByLabel('線種').selectOption('dotted');
  expect((await objects(page))[0].strokeStyle).toBe('dotted');

  // Lines.
  await page.keyboard.press('Escape');
  await page.locator('[data-tool="line"]').click();
  const lineSettings = page.getByRole('group', { name: '新しいラインの設定' });
  await expect(lineSettings.getByRole('button', { name: '塗り', exact: true })).toHaveCount(0);
  await setNumber(lineSettings, '線幅', '7');
  await lineSettings.getByLabel('線種').selectOption('dotted');
  await drag(page, { x: c.x + 50, y: c.y + 300 }, { x: c.x + 250, y: c.y + 300 });
  o = (await objects(page))[1];
  expect(o).toMatchObject({ type: 'path', name: '直線', fill: null, strokeWidth: 7, strokeStyle: 'dotted' });

  // Text.
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  const textSettings = page.getByRole('group', { name: '新しいテキストの設定' });
  await setNumber(textSettings, 'フォントサイズ', '48');
  await textSettings.getByTitle('太字').click();
  await page.mouse.click(c.x + 400, c.y + 400);
  await expect(page.locator('textarea.text-editor')).toBeFocused();
  await page.keyboard.type('Hi');
  await page.keyboard.press('Escape');
  o = (await objects(page))[2];
  expect(o).toMatchObject({ type: 'text', fontSize: 48, bold: true });

  // Remembered after a reload.
  await page.reload();
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
  await page.keyboard.press('r');
  await expect(page.getByRole('group', { name: '新しい図形の設定' }).getByLabel('線種')).toHaveValue('dashed');
  // Also shown while an object is selected, above that object's own settings.
  await drag(page, { x: c.x + 50, y: c.y + 50 }, { x: c.x + 150, y: c.y + 150 });
  expect(await state<string[]>(page, 's => s.selection')).toHaveLength(1);
  await page.keyboard.press('r');
  const settings = page.getByRole('group', { name: '新しい図形の設定' });
  await expect(settings).toBeVisible();
  const selected = page.getByRole('group', { name: '選択中のオブジェクト' });
  await expect(selected).toBeVisible();
  // Each part changes only its own target.
  await settings.getByLabel('線種').selectOption('solid');
  expect(await state(page, 's => s.toolDefaults.shape.strokeStyle')).toBe('solid');
  expect(await state(page, 's => s.doc.layers[0].children[0].strokeStyle')).toBe('dashed');
  await selected.getByLabel('線種').selectOption('dotted');
  expect(await state(page, 's => s.doc.layers[0].children[0].strokeStyle')).toBe('dotted');
  expect(await state(page, 's => s.toolDefaults.shape.strokeStyle')).toBe('solid');
  // The select tool shows only the object.
  await page.keyboard.press('v');
  await expect(page.getByTestId('tool-defaults')).toHaveCount(0);
  await expect(page.getByRole('group', { name: '選択中のオブジェクト' })).toHaveCount(0);
});

test('lines are paths: the subselect tool moves their points freely, and old line shapes convert', async ({ page }) => {
  const c = await canvasBox(page);
  await page.locator('[data-tool="line"]').click();
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 300, y: c.y + 100 });
  await page.keyboard.press('a');
  const end = page.locator('[data-node="1"]');
  await expect(end).toBeVisible();
  const b = (await end.boundingBox())!;
  await drag(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, { x: c.x + 250, y: c.y + 220 });
  const toDoc = await state<{ x: number; y: number }[]>(
    page,
    's => { const o = s.doc.layers[0].children[0]; return o.nodes.map(n => ({ x: o.box.x + n.anchor.x * o.box.width, y: o.box.y + n.anchor.y * o.box.height })); }',
  );
  expect(toDoc[0].x).toBeCloseTo(100, 0);
  expect(toDoc[0].y).toBeCloseTo(100, 0);
  expect(toDoc[1].x).toBeCloseTo(250, 0);
  expect(toDoc[1].y).toBeCloseTo(220, 0);

  // A line shape from an older document becomes a path when edited with the subselect tool.
  await page.keyboard.press('v');
  await page.evaluate(() => {
    const ed = (window as never as { __sparca: { edit(l: string, f: (d: { layers: { children: unknown[] }[] }) => void): void; select(ids: string[]): void } }).__sparca;
    ed.edit('add', (d) => {
      d.layers[0].children.push({
        id: 'oldline', name: '直線', type: 'shape', visible: true, locked: false, opacity: 1,
        box: { x: 100, y: 400, width: 200, height: 1, rotation: 0 }, effects: [],
        shape: { kind: 'line', from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } },
        fill: null, stroke: '#222222', strokeWidth: 3,
      });
    });
    ed.select(['oldline']);
  });
  await page.keyboard.press('a');
  await expect.poll(() => state<string>(page, 's => s.doc.layers[0].children[1].type')).toBe('path');
  expect(await state<string>(page, 's => s.doc.layers[0].children[1].id')).toBe('oldline');
  await expect(page.locator('[data-node="1"]')).toBeVisible();
  // The conversion is one undo step, and undoing it does not convert it again.
  await page.keyboard.press('Control+z');
  expect(await state<string>(page, 's => s.doc.layers[0].children[1].type')).toBe('shape');
});
