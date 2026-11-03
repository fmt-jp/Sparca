// 編集できる PNG (.hnb.png): the default save format — a normal PNG of the canvas that HANABI opens as a project.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { canvasBox, decodePixels, disableNativePickers, drag, setColor, state } from './helpers';

const props = (page: Page) => page.getByRole('region', { name: 'プロパティ' });

async function redRect(page: Page) {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 300, y: c.y + 200 });
  await setColor(page, props(page), '塗り', '#ff0000');
}

test('Ctrl+S saves an editable PNG: the picture of the canvas, and it reopens for editing', async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
  await expect(props(page)).toBeVisible();
  await redRect(page);
  const before = await state<unknown>(page, 's => s.doc');
  const dl = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const download = await dl;
  expect(download.suggestedFilename()).toBe('untitled.hnb.png');
  const bytes = readFileSync((await download.path())!);
  // Any image viewer sees the canvas (800 × 600) with the red rectangle on white.
  const { width, height, px } = await decodePixels(page, bytes, 'image/png', [[200, 150], [50, 50]]);
  expect([width, height]).toEqual([800, 600]);
  expect(px[0].slice(0, 3)).toEqual([255, 0, 0]);
  expect(px[1].slice(0, 3)).toEqual([255, 255, 255]);
  await expect(page.locator('.dirty-mark')).toHaveCount(0);
  expect(await state(page, 's => s.fileName')).toBe('untitled.hnb.png');

  await page.reload();
  await expect(props(page)).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /開く/ }).click();
  await (await chooser).setFiles({ name: '作品.hnb.png', mimeType: 'image/png', buffer: bytes });
  // Opened as the project (a shape to edit), not as a flat image.
  await expect.poll(() => state<string>(page, 's => s.doc.layers[0].children[0]?.type')).toBe('shape');
  expect(await state<unknown>(page, 's => s.doc')).toEqual(before);
  expect(await state(page, 's => s.fileName')).toBe('作品.hnb.png');
});

test('in the save dialog the format can be .hnb; overwriting keeps the format of the file', async ({ page }) => {
  // A stand-in for the browser's save dialog: the user picks a name ending in .hnb.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__writes = [];
    w.__asked = [];
    w.showSaveFilePicker = async (o: { suggestedName: string; types: { description: string }[] }) => {
      (w.__asked as unknown[]).push({ name: o.suggestedName, first: o.types[0].description });
      return {
        name: '作品.hnb',
        getFile: async () => new File([], 'x'),
        createWritable: async () => ({
          write: async (b: Blob) => void (w.__writes as unknown[]).push(Array.from(new Uint8Array(await b.slice(0, 4).arrayBuffer()))),
          close: async () => undefined,
        }),
      };
    };
  });
  await page.goto('/');
  await expect(props(page)).toBeVisible();
  await redRect(page);
  await page.keyboard.press('Control+s');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __writes: unknown[] }).__writes.length)).toBe(1);
  // The dialog offered the editable PNG first, named untitled.hnb.png.
  expect(await page.evaluate(() => (window as unknown as { __asked: unknown[] }).__asked)).toEqual([{ name: 'untitled.hnb.png', first: '編集できる PNG（HANABI）' }]);
  // A .hnb name gets the ZIP project ("PK").
  expect(await page.evaluate(() => (window as unknown as { __writes: number[][] }).__writes[0].slice(0, 2))).toEqual([0x50, 0x4b]);
  expect(await state(page, 's => s.fileName')).toBe('作品.hnb');
  // Ctrl+S again overwrites the same file without asking, still as .hnb.
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+s');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __writes: unknown[] }).__writes.length)).toBe(2);
  expect(await page.evaluate(() => (window as unknown as { __asked: unknown[] }).__asked.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __writes: number[][] }).__writes[1].slice(0, 2))).toEqual([0x50, 0x4b]);
});
