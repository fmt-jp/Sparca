// Range selection + Delete erases those pixels (transparent), Ctrl+X copies then erases.
import { expect, test, type Page } from '@playwright/test';
import { canvasBox, disableNativePickers, drag, makePng, placePng, processedPixels, state } from './helpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

type Img = { id: string; type: string; box: { x: number; y: number }; pipeline: { localEdits: { kind: string }[] } };
const objects = (page: Page) => state<Img[]>(page, 's => s.doc.layers[0].children');

async function setup(page: Page) {
  await placePng(page, 'red.png', makePng(200, 100, () => [220, 30, 40, 255]));
  const [img] = await objects(page);
  const c = await canvasBox(page);
  // Select image pixels x 20..80 over the full height.
  await page.keyboard.press('m');
  await drag(page, { x: c.x + img.box.x + 20, y: c.y + img.box.y - 10 }, { x: c.x + img.box.x + 80, y: c.y + img.box.y + 110 });
  return img;
}

test('Delete erases the selected pixels (kept as an editable step); without a range selection it deletes the object', async ({ page }) => {
  const img = await setup(page);
  await page.keyboard.press('Delete');
  expect((await objects(page)).length).toBe(1);
  expect((await objects(page))[0].pipeline.localEdits).toMatchObject([{ kind: 'erase' }]);
  expect(await state<string>(page, 's => s.history.past.at(-1).label')).toBe('選択範囲を消去');
  const out = await processedPixels(page, img.id, [[50, 50], [10, 50], [150, 50]]);
  expect(out.px[0][3]).toBe(0); // erased → transparent
  expect(out.px[1]).toEqual([220, 30, 40, 255]);
  expect(out.px[2]).toEqual([220, 30, 40, 255]);
  // Listed with the other partial edits and removable.
  await page.keyboard.press('Escape'); // clear the range selection
  await page.keyboard.press('v');
  await page.locator('[data-object-row="red.png"]').click();
  await expect(page.getByRole('region', { name: 'プロパティ' })).toContainText('部分加工 1 件（消去 1）');
  await page.keyboard.press('Control+z');
  expect((await objects(page))[0].pipeline.localEdits).toEqual([]);
  // No range selection: Delete removes the selected object as before.
  await page.keyboard.press('Delete');
  expect(await objects(page)).toHaveLength(0);
});

test('Ctrl+X copies the selected pixels and erases them; 画像 → 選択範囲を消去 does the same as Delete', async ({ page }) => {
  const img = await setup(page);
  await page.keyboard.press('Control+x');
  await expect.poll(async () => (await objects(page))[0].pipeline.localEdits.length).toBe(1);
  expect(await state<string>(page, 's => s.history.past.at(-1).label')).toBe('選択範囲をカット');
  expect((await processedPixels(page, img.id, [[50, 50]])).px[0][3]).toBe(0);
  // Paste puts the cut pixels back in place as a new image.
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await objects(page)).length).toBe(2);
  const pasted = (await objects(page))[1];
  expect((await processedPixels(page, pasted.id, [[30, 50]])).px[0]).toEqual([220, 30, 40, 255]);
  // Menu entry.
  await page.keyboard.press('Control+z'); // paste
  await page.keyboard.press('Control+z'); // cut
  await page.getByRole('button', { name: '画像', exact: true }).click();
  await page.getByRole('menuitem', { name: '選択範囲を消去' }).click();
  expect((await objects(page))[0].pipeline.localEdits).toMatchObject([{ kind: 'erase' }]);
});
