// The layers panel's trash button (2026-11-17): with objects selected it deletes them (as
// Delete does); with nothing selected it deletes the active layer, as before.
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, state } from './helpers';

const panel = (page: Page) => page.getByRole('complementary', { name: 'レイヤー' });

async function rect(page: Page, x: number) {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await page.mouse.move(c.x + x, c.y + 100);
  await page.mouse.down();
  await page.mouse.move(c.x + x + 80, c.y + 180, { steps: 3 });
  await page.mouse.up();
}

test('the trash button deletes the selected objects, or the layer when nothing is selected', async ({ page }) => {
  await page.goto('/');
  await rect(page, 80);
  await rect(page, 240);
  const count = () => state<number>(page, 's => s.doc.layers.reduce((n, l) => n + l.children.length, 0)');
  expect(await count()).toBe(2);

  // One object selected (the last drawn): only it goes; undo brings it back.
  await expect(panel(page).getByRole('button', { name: '選択中のオブジェクトを削除' })).toBeEnabled();
  await panel(page).getByRole('button', { name: '選択中のオブジェクトを削除' }).click();
  expect(await count()).toBe(1);
  expect(await state<number>(page, 's => s.doc.layers.length')).toBe(1);
  await page.keyboard.press('Control+z');
  expect(await count()).toBe(2);

  // A locked selected object cannot be deleted from here.
  await page.evaluate(() => {
    const s = (window as unknown as { __sparca: { edit(l: string, f: (d: { layers: { children: { locked: boolean; id: string }[] }[] }) => void): void; getState(): { doc: { layers: { children: { id: string }[] }[] } }; select(ids: string[]): void } }).__sparca;
    s.edit('t', (d) => {
      d.layers[0].children[0].locked = true;
    });
    s.select([s.getState().doc.layers[0].children[0].id]);
  });
  await expect(panel(page).getByRole('button', { name: '選択中のオブジェクトを削除' })).toBeDisabled();

  // Nothing selected: the layer (after a second one is added, as the last cannot go).
  await page.evaluate(() => (window as unknown as { __sparca: { select(ids: string[]): void } }).__sparca.select([]));
  await panel(page).getByRole('button', { name: '新規レイヤー' }).click();
  expect(await state<number>(page, 's => s.doc.layers.length')).toBe(2);
  await panel(page).getByRole('button', { name: 'レイヤーを削除' }).click();
  expect(await state<number>(page, 's => s.doc.layers.length')).toBe(1);
  expect(await count()).toBe(2);
});
