// Fill, stroke and effects of several objects at once (2026-11-18): differing settings show
// 混在; a change goes to all the selected objects (text takes a fill as its color, stroke only
// shapes and paths), as one undo step.
import { expect, test, type Page } from '@playwright/test';
import { addEffect, canvasBox, state } from './helpers';

type O = { type: string; fill?: unknown; color?: unknown; stroke?: unknown; strokeWidth?: number; strokeStyle?: string; effects: { kind: string; strength: number }[] };
const objects = (page: Page) => state<O[]>(page, 's => s.doc.layers[0].children');
const props = (page: Page) => page.getByRole('region', { name: 'プロパティ' });

test('several objects: fill, stroke and effects set on all at once; 混在 for differing ones', async ({ page }) => {
  await page.goto('/');
  const c = await canvasBox(page);
  for (const x of [60, 260]) {
    await page.keyboard.press('r');
    await page.mouse.move(c.x + x, c.y + 80);
    await page.mouse.down();
    await page.mouse.move(c.x + x + 150, c.y + 200, { steps: 3 });
    await page.mouse.up();
  }
  await page.keyboard.press('t');
  await page.mouse.click(c.x + 480, c.y + 120);
  await page.keyboard.type('ABC');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const s = (window as unknown as { __sparca: { edit(l: string, f: (d: { layers: { children: Record<string, unknown>[] }[] }) => void): void; getState(): { doc: { layers: { children: { id: string }[] }[] } }; select(ids: string[]): void; set(p: object): void } }).__sparca;
    s.edit('t', (d) => {
      const [a, b] = d.layers[0].children;
      a.fill = '#ff0000';
      b.fill = '#00aa00';
      b.stroke = '#000000';
      b.strokeWidth = 4;
      a.effects = [{ id: 'e1', kind: 'drop-shadow', enabled: true, strength: 1, color: '#000000', opacity: 0.5, angle: 45, distance: 6, blur: 4 }];
    });
    s.select(s.getState().doc.layers[0].children.map((o) => o.id));
    s.set({ tool: 'select' });
  });

  // Differing fill, stroke width and effects are marked.
  const mixed = (name: string) => props(page).getByRole('group', { name }).locator('.mixed-badge');
  await expect(mixed('塗り')).toBeVisible();
  await expect(mixed('線幅')).toBeVisible();
  await expect(props(page).getByRole('group', { name: 'エフェクト' }).locator('.mixed-badge')).toBeVisible();

  // Stroke width → both rectangles (the text has no stroke).
  const w = props(page).locator('input[type="text"][aria-label="線幅"]');
  await w.fill('6');
  await w.press('Enter');
  let os = await objects(page);
  expect(os.filter((o) => o.type === 'shape').map((o) => o.strokeWidth)).toEqual([6, 6]);
  await expect(mixed('線幅')).toHaveCount(0);
  // Line style.
  await props(page).getByLabel('線種').selectOption('dashed');
  os = await objects(page);
  expect(os.filter((o) => o.type === 'shape').map((o) => o.strokeStyle)).toEqual(['dashed', 'dashed']);

  // A pattern fill → both rectangles' fill and the text's color.
  await props(page).getByLabel('塗りの種類').selectOption('pattern');
  os = await objects(page);
  expect(os.map((o) => ((o.type === 'text' ? o.color : o.fill) as { kind?: string }).kind)).toEqual(['pattern', 'pattern', 'pattern']);
  await expect(mixed('塗り')).toHaveCount(0);
  // One undo step for all three.
  await page.keyboard.press('Control+z');
  os = await objects(page);
  expect(os.map((o) => (o.type === 'text' ? o.color : o.fill))).toEqual(['#ff0000', '#00aa00', expect.anything()]);
  expect(typeof os[2].color).toBe('string');

  // Effects that differ: add one to all, then make them all like the first.
  await addEffect(page, 'シャドウとグロー', 'グロー');
  os = await objects(page);
  expect(os.map((o) => o.effects.map((e) => e.kind))).toEqual([['drop-shadow', 'glow'], ['glow'], ['glow']]);
  await props(page).getByRole('button', { name: '先頭のオブジェクトにそろえる' }).click();
  os = await objects(page);
  expect(os.map((o) => o.effects.map((e) => e.kind))).toEqual([
    ['drop-shadow', 'glow'],
    ['drop-shadow', 'glow'],
    ['drop-shadow', 'glow'],
  ]);
  // Now the same: the usual list, and a change goes to all.
  await expect(props(page).getByRole('group', { name: 'エフェクト' }).locator('.mixed-badge')).toHaveCount(0);
  await props(page).getByRole('button', { name: 'グローを削除', exact: true }).click();
  os = await objects(page);
  expect(os.map((o) => o.effects.map((e) => e.kind))).toEqual([['drop-shadow'], ['drop-shadow'], ['drop-shadow']]);
  await props(page).getByRole('button', { name: 'すべて削除' }).count().then((n) => expect(n).toBe(0));
});
