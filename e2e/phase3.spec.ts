import { expect, test, type Page } from '@playwright/test';
import { addEffect, canvasBox, disableNativePickers, drag, makePng, placePng, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

type Obj = { id: string; type: string; name: string; closed?: boolean; nodes?: { in: unknown; out: unknown }[]; fill?: string; stroke?: string; shape?: { kind: string; sides?: number }; effects?: { glow: { enabled: boolean }; dropShadow: { enabled: boolean } }; children?: Obj[]; box?: { x: number; y: number } };
const objects = (page: Page) => state<Obj[]>(page, 's => s.doc.layers.flatMap(l => l.children)');

async function setNumber(page: Page, label: string, value: string) {
  const input = page.getByRole('region', { name: 'プロパティ' }).locator(`input[type="text"][aria-label="${label}"]`);
  await input.fill(value);
  await input.press('Enter');
}

test('pen tool draws an editable bezier path (corner + smooth anchors), open or closed', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('p');
  await page.mouse.click(c.x + 100, c.y + 100); // corner
  await drag(page, { x: c.x + 200, y: c.y + 200 }, { x: c.x + 260, y: c.y + 200 }); // smooth
  await page.mouse.click(c.x + 300, c.y + 100); // corner
  await expect(page.getByTestId('pen-preview')).toBeVisible();
  await page.keyboard.press('Enter');
  let objs = await objects(page);
  expect(objs).toHaveLength(1);
  expect(objs[0]).toMatchObject({ type: 'path', closed: false });
  expect(objs[0].nodes).toHaveLength(3);
  expect(objs[0].nodes![0].out).toBeNull();
  expect(objs[0].nodes![1].out).not.toBeNull();
  expect(objs[0].nodes![1].in).not.toBeNull();
  // Finishing a path returns to the select tool; pick the pen again for the next one.
  expect(await state<string>(page, 's => s.tool')).toBe('select');
  await page.keyboard.press('p');
  // Closed triangle by clicking the first anchor again.
  await page.mouse.click(c.x + 400, c.y + 300);
  await page.mouse.click(c.x + 500, c.y + 300);
  await page.mouse.click(c.x + 450, c.y + 380);
  await page.mouse.click(c.x + 400, c.y + 300);
  objs = await objects(page);
  expect(objs[1]).toMatchObject({ type: 'path', closed: true });
  expect(objs[1].nodes).toHaveLength(3);
  // The path is a normal object: it can be selected and moved.
  await page.keyboard.press('v');
  await page.locator('[data-object-row="パス"]').first().click(); // rows list topmost first
  await page.keyboard.press('ArrowRight');
  expect((await objects(page))[1].box!.x).toBeCloseTo(objs[1].box!.x + 1);
});

test('polygon, star and arrow shapes with editable parameters', async ({ page }) => {
  const c = await canvasBox(page);
  await page.locator('[data-tool="rect"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '多角形ツール' }).click();
  await drag(page, { x: c.x + 50, y: c.y + 50 }, { x: c.x + 150, y: c.y + 150 });
  await setNumber(page, '頂点数', '8');
  expect((await objects(page))[0].shape).toMatchObject({ kind: 'polygon', sides: 8 });
  // After drawing, the select tool is active again; pick the star from the shape group.
  expect(await state<string>(page, 's => s.tool')).toBe('select');
  await page.locator('[data-tool="polygon"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '星ツール' }).click();
  expect(await state<string>(page, 's => s.tool')).toBe('star');
  await drag(page, { x: c.x + 200, y: c.y + 50 }, { x: c.x + 300, y: c.y + 150 });
  await setNumber(page, '頂点数', '6');
  expect((await objects(page))[1].shape).toMatchObject({ kind: 'star', points: 6 });
  // R cycles through the shape group, which ends with the arrow tool.
  for (const t of ['rect', 'rounded-rect', 'ellipse', 'polygon', 'star', 'arrow']) {
    await page.keyboard.press('r');
    expect(await state<string>(page, 's => s.tool')).toBe(t);
  }
  // It is also listed in the shape group's flyout.
  await page.locator('[data-tool="arrow"]').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '矢印ツール' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '角丸矩形ツール' })).toBeVisible();
  await page.getByRole('menuitem', { name: '矢印ツール' }).click();
  expect(await state<string>(page, 's => s.tool')).toBe('arrow');
  await drag(page, { x: c.x + 50, y: c.y + 300 }, { x: c.x + 300, y: c.y + 300 });
  expect((await objects(page))[2].shape!.kind).toBe('block-arrow');
  await expect(page.locator('[data-testid=canvas] path')).toHaveCount(3); // polygon, star, block arrow
});

test('glow and drop shadow on text and shapes are kept as editable settings', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('t');
  await page.mouse.click(c.x + 100, c.y + 100);
  await expect(page.locator('textarea.text-editor')).toBeFocused();
  await page.keyboard.type('Glow');
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.locator('[data-object-row="テキスト"]').click();
  await addEffect(page, 'シャドウとグロー', 'グロー');
  await addEffect(page, 'シャドウとグロー', 'ドロップシャドウ');
  await setNumber(page, 'ドロップシャドウの距離', '12');
  const t = (await objects(page))[0] as Obj & { effects: { kind: string; enabled: boolean; distance?: number }[] };
  expect(t.effects.map((e) => e.kind)).toEqual(['glow', 'drop-shadow']);
  expect(t.effects[1]).toMatchObject({ enabled: true, distance: 12 });
  // Rendered as SVG filters (not baked into pixels).
  await expect(page.locator('[data-testid=canvas] filter feMorphology')).toHaveCount(1);
  await expect(page.locator('[data-testid=canvas] filter feOffset')).toHaveCount(1);
  await page.getByLabel('グローを有効にする').uncheck();
  await expect(page.locator('[data-testid=canvas] filter feMorphology')).toHaveCount(0);
});

test('group, transform as a unit, align and copy/paste', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 50, y: c.y + 50 }, { x: c.x + 100, y: c.y + 100 });
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 200, y: c.y + 80 }, { x: c.x + 260, y: c.y + 140 });
  await page.keyboard.press('v');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  let objs = await objects(page);
  expect(objs).toHaveLength(1);
  expect(objs[0].type).toBe('group');
  // Move the group by dragging one of its members.
  await drag(page, { x: c.x + 75, y: c.y + 75 }, { x: c.x + 95, y: c.y + 105 });
  objs = await objects(page);
  expect(objs[0].children!.map((o) => [Math.round(o.box!.x), Math.round(o.box!.y)])).toEqual([[70, 80], [220, 110]]);
  // Ungroup, align tops.
  await page.keyboard.press('Control+Shift+g');
  await page.getByRole('button', { name: '上揃え' }).click();
  objs = await objects(page);
  expect(objs.map((o) => Math.round(o.box!.y))).toEqual([80, 80]);
  // Copy & paste creates offset copies with new ids.
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  const after = await objects(page);
  expect(after).toHaveLength(4);
  expect(new Set(after.map((o) => o.id)).size).toBe(4);
  expect(Math.round(after[2].box!.x)).toBe(Math.round(objs[0].box!.x) + 10);
});

test('eyedropper picks a color from an image and applies it to the selected shape', async ({ page }) => {
  await placePng(page, 'red.png', makePng(100, 100, () => [220, 30, 40, 255]));
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 20, y: c.y + 20 }, { x: c.x + 80, y: c.y + 80 });
  await page.keyboard.press('i');
  await expect(page.getByTestId('eyedropper-panel')).toBeVisible();
  await page.mouse.click(c.x + 400, c.y + 300); // center of the image
  await expect(page.getByTestId('picked-color')).toHaveText('#dc1e28');
  const rect = (await objects(page)).find((o) => o.type === 'shape')!;
  expect(rect.fill).toBe('#dc1e28');
  // Stroke target
  await page.getByTestId('eyedropper-panel').getByLabel('線').check();
  await page.mouse.click(c.x + 700, c.y + 100); // white background
  await expect.poll(async () => (await objects(page)).find((o) => o.type === 'shape')!.stroke).toBe('#ffffff');
});

test('tool shortcuts still work after clicking a checkbox in the properties panel', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 50, y: c.y + 50 }, { x: c.x + 100, y: c.y + 100 });
  await addEffect(page, 'シャドウとグロー', 'グロー');
  await page.getByLabel('グローを有効にする').uncheck();
  await page.keyboard.press('p');
  expect(await state<string>(page, 's => s.tool')).toBe('pen');
});

test('pen tool: Shift keeps the next anchor level with or straight below the previous one', async ({ page }) => {
  const c = await canvasBox(page);
  await page.keyboard.press('p');
  await page.mouse.click(c.x + 100, c.y + 100);
  // The rubber line follows Shift as soon as it is pressed.
  await page.mouse.move(c.x + 300, c.y + 130);
  const rubber = page.locator('[data-testid="pen-preview"] .pen-rubber');
  await expect(rubber).toHaveAttribute('y2', '130');
  await page.keyboard.down('Shift');
  await expect(rubber).toHaveAttribute('y2', '100');
  await page.mouse.click(c.x + 300, c.y + 130); // → (300, 100)
  await page.mouse.click(c.x + 315, c.y + 300); // → (300, 300)
  await page.keyboard.up('Shift');
  await page.mouse.click(c.x + 150, c.y + 320); // free
  await page.keyboard.press('Enter');
  const anchors = await state<{ x: number; y: number }[]>(
    page,
    's => { const o = s.doc.layers[0].children[0]; return o.nodes.map(n => ({ x: Math.round(o.box.x + n.anchor.x * o.box.width), y: Math.round(o.box.y + n.anchor.y * o.box.height) })); }',
  );
  expect(anchors).toEqual([
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 300 },
    { x: 150, y: 320 },
  ]);
});
