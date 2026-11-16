// ライブラリ (2026-11-16): register an object's effects / fill / stroke, apply them (click,
// Shift+click, drag onto an object), and carry them between browsers as .hnbfx files.
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, disableNativePickers, state } from './helpers';

type Fx = { kind: string };
type Obj = { name: string; effects: Fx[]; fill: unknown; stroke: unknown; strokeWidth: number };
const objects = (page: Page) => state<Obj[]>(page, 's => s.doc.layers[0].children');
const panel = (page: Page) => page.getByRole('region', { name: 'ライブラリ' });
const libItem = (page: Page, name: string) => panel(page).locator(`[data-library-item="${name}"]`);

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
  await expect(panel(page)).toBeVisible();
});

/** Two rectangles; the first has a bevel, a shadow, a red fill and a 3 px blue stroke. */
async function setup(page: Page) {
  const c = await canvasBox(page);
  for (const x of [60, 360]) {
    await page.keyboard.press('r');
    await page.mouse.move(c.x + x, c.y + 60);
    await page.mouse.down();
    await page.mouse.move(c.x + x + 200, c.y + 160, { steps: 3 });
    await page.mouse.up();
  }
  await page.evaluate(() => {
    const ed = (window as unknown as { __sparca: { edit(l: string, f: (d: { layers: { children: Record<string, unknown>[] }[] }) => void): void } }).__sparca;
    ed.edit('t', (d) => {
      const a = d.layers[0].children[0];
      a.name = 'ゴールド';
      a.fill = '#ff0000';
      a.stroke = '#0000ff';
      a.strokeWidth = 3;
      a.effects = [
        { id: 'e1', kind: 'bevel-inner', enabled: true, strength: 1, width: 10, softness: 3, angle: -135, intensity: 0.75 },
        { id: 'e2', kind: 'drop-shadow', enabled: true, strength: 1, color: '#000000', opacity: 0.5, angle: 45, distance: 6, blur: 4 },
      ];
      d.layers[0].children[1].effects = [{ id: 'e3', kind: 'glow', enabled: true, strength: 1, color: '#ffd84a', opacity: 0.9, blur: 6, spread: 2 }];
    });
  });
  return c;
}

async function select(page: Page, index: number) {
  await page.evaluate((i) => {
    const s = (window as unknown as { __sparca: { getState(): { doc: { layers: { children: { id: string }[] }[] } }; select(ids: string[]): void } }).__sparca;
    s.select([s.getState().doc.layers[0].children[i].id]);
  }, index);
}

async function register(page: Page, index: number, name: string, without: string[] = []) {
  await select(page, index);
  await panel(page).getByRole('button', { name: 'ライブラリに登録' }).click();
  const dlg = page.getByRole('dialog', { name: 'ライブラリに登録' });
  await dlg.getByLabel('名前').fill(name);
  for (const part of without) await dlg.getByLabel(part, { exact: true }).uncheck();
  await dlg.getByRole('button', { name: '登録' }).click();
  await expect(libItem(page, name)).toBeVisible();
}

test('register, then apply with a click (replace) and Shift+click (effects after); undo; kept after reload', async ({ page }) => {
  await setup(page);
  // Nothing selected: ＋ is off.
  await page.keyboard.press('Escape');
  await expect(panel(page).getByRole('button', { name: 'ライブラリに登録' })).toBeDisabled();
  await register(page, 0, 'ゴールド');

  await select(page, 1);
  await libItem(page, 'ゴールド').click();
  let o = (await objects(page))[1];
  expect(o.effects.map((e) => e.kind)).toEqual(['bevel-inner', 'drop-shadow']);
  expect([o.fill, o.stroke, o.strokeWidth]).toEqual(['#ff0000', '#0000ff', 3]);
  await page.keyboard.press('Control+z');
  expect((await objects(page))[1].effects.map((e) => e.kind)).toEqual(['glow']);
  await libItem(page, 'ゴールド').click({ modifiers: ['Shift'] });
  o = (await objects(page))[1];
  expect(o.effects.map((e) => e.kind)).toEqual(['glow', 'bevel-inner', 'drop-shadow']);

  // Only the effects: fill and stroke stay.
  await register(page, 0, '影だけ', ['塗り', '線']);
  await page.evaluate(() => {
    const ed = (window as unknown as { __sparca: { edit(l: string, f: (d: { layers: { children: Record<string, unknown>[] }[] }) => void): void } }).__sparca;
    ed.edit('t', (d) => {
      Object.assign(d.layers[0].children[1], { fill: '#00ff00', stroke: null, effects: [] });
    });
  });
  await select(page, 1);
  await libItem(page, '影だけ').click();
  o = (await objects(page))[1];
  expect([o.effects.length, o.fill, o.stroke]).toEqual([2, '#00ff00', null]);

  await page.reload();
  await expect(libItem(page, 'ゴールド')).toBeVisible();
  await expect(libItem(page, '影だけ')).toBeVisible();
});

test('drag an item onto an object applies it there; the panel folds and keeps its height', async ({ page }) => {
  await setup(page);
  await register(page, 0, 'ゴールド');
  await page.keyboard.press('Escape');
  await libItem(page, 'ゴールド').dragTo(page.getByTestId('canvas'), { targetPosition: { x: 460, y: 110 } });
  const o = (await objects(page))[1];
  expect(o.effects.map((e) => e.kind)).toEqual(['bevel-inner', 'drop-shadow']);
  expect(await state<string[]>(page, 's => s.selection')).toHaveLength(1);

  // Fold to the header and back (remembered).
  await panel(page).getByRole('button', { name: /ライブラリ/, expanded: true }).click();
  await expect(libItem(page, 'ゴールド')).toBeHidden();
  await page.reload();
  await expect(libItem(page, 'ゴールド')).toBeHidden();
  await panel(page).getByRole('button', { name: /ライブラリ/, expanded: false }).click();
  await expect(libItem(page, 'ゴールド')).toBeVisible();
});

test('right-click: rename, duplicate, overwrite from the selection, delete', async ({ page }) => {
  await setup(page);
  await register(page, 0, 'ゴールド');
  await libItem(page, 'ゴールド').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '名前の変更…' }).click();
  const dlg = page.getByRole('dialog', { name: '名前の変更' });
  await dlg.getByLabel('名前').fill('金');
  await dlg.getByRole('button', { name: 'OK' }).click();
  await expect(libItem(page, '金')).toBeVisible();

  await libItem(page, '金').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '複製' }).click();
  await expect(libItem(page, '金 2')).toBeVisible();

  // 上書き with the second rectangle (a glow, no stroke).
  await select(page, 1);
  await libItem(page, '金 2').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '選択中のオブジェクトで上書き' }).click();
  await select(page, 0);
  await libItem(page, '金 2').click();
  expect((await objects(page))[0].effects.map((e) => e.kind)).toEqual(['glow']);

  page.once('dialog', (d) => void d.accept());
  await libItem(page, '金 2').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '削除' }).click();
  await expect(libItem(page, '金 2')).toHaveCount(0);
  await expect(libItem(page, '金')).toBeVisible();
});

test('export to a .hnbfx file and import it (same names: rename / replace / skip); a wrong file is refused', async ({ page }) => {
  await setup(page);
  await register(page, 0, 'ゴールド');
  await register(page, 1, '光彩');
  const download = page.waitForEvent('download');
  await panel(page).getByRole('button', { name: 'ライブラリをすべてエクスポート' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('HANABI-library.hnbfx');
  const path = await file.path();
  const json = JSON.parse(await readFile(path, 'utf8'));
  expect(json).toMatchObject({ format: 'hanabi-library', version: 1 });
  expect(json.items).toHaveLength(2);

  // Into the same library: both names are taken.
  const chooser = page.waitForEvent('filechooser');
  await panel(page).getByRole('button', { name: 'ライブラリのインポート' }).click();
  await (await chooser).setFiles(path);
  const dlg = page.getByRole('dialog', { name: 'ライブラリのインポート' });
  await expect(dlg.getByText('同じ名前あり')).toHaveCount(2);
  await dlg.getByLabel('「光彩」の取り込み方').selectOption('skip');
  await dlg.getByRole('button', { name: 'インポート' }).click();
  await expect(libItem(page, 'ゴールド 2')).toBeVisible();
  await expect(panel(page).locator('[data-library-item]')).toHaveCount(3);

  // Not a library file.
  const bad = page.waitForEvent('filechooser');
  await panel(page).getByRole('button', { name: 'ライブラリのインポート' }).click();
  await (await bad).setFiles({ name: 'x.hnbfx', mimeType: 'application/json', buffer: Buffer.from('{"format":"other"}') });
  await expect(page.locator('.notice.error')).toContainText('ライブラリファイルではありません');
});
