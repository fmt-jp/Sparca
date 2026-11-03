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
  // The dialog offered the editable PNG first, with the name only (it adds the extension of the chosen type).
  expect(await page.evaluate(() => (window as unknown as { __asked: unknown[] }).__asked)).toEqual([{ name: 'untitled', first: '編集できる PNG（HANABI）' }]);
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

test('save as from a .hnb gives the dialog the bare name and both types, .hnb first (each type adds its own extension)', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__asked = [];
    w.showSaveFilePicker = async (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => {
      // Like Chrome when an accept list is not allowed: refuse before showing the dialog.
      if ((w.__refuseTwoDots as boolean) && o.types.some((t) => Object.values(t.accept).flat().some((x) => x.split('.').length > 2))) {
        throw new TypeError('Extension is not valid');
      }
      (w.__asked as unknown[]).push({ name: o.suggestedName, types: o.types.map((t) => [t.description, Object.values(t.accept).flat()]) });
      throw new DOMException('cancelled', 'AbortError');
    };
  });
  await page.goto('/');
  await expect(props(page)).toBeVisible();
  await page.evaluate(() => (window as unknown as { __sparca: { set(p: object): void } }).__sparca.set({ fileName: '作品.hnb' }));
  await page.keyboard.press('Control+Shift+S');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __asked: unknown[] }).__asked.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __asked: unknown[] }).__asked[0])).toEqual({
    name: '作品',
    types: [
      ['HANABI プロジェクト', ['.hnb']],
      ['編集できる PNG（HANABI）', ['.hnb.png', '.png']],
    ],
  });
  // A browser refusing two-dot extensions still gets a dialog (with .png).
  await page.evaluate(() => ((window as unknown as Record<string, unknown>).__refuseTwoDots = true));
  await page.keyboard.press('Control+Shift+S');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __asked: unknown[] }).__asked.length)).toBe(2);
  expect(await page.evaluate(() => (window as unknown as { __asked: { types: unknown[][] }[] }).__asked[1].types[1])).toEqual(['編集できる PNG（HANABI）', ['.png']]);
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

test('a name that comes back without an extension keeps the suggested format', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__writes = [];
    w.showSaveFilePicker = async () => ({
      name: '作品',
      getFile: async () => new File([], 'x'),
      createWritable: async () => ({
        write: async (b: Blob) => void (w.__writes as unknown[]).push(Array.from(new Uint8Array(await b.slice(0, 4).arrayBuffer()))),
        close: async () => undefined,
      }),
    });
  });
  await page.goto('/');
  await expect(props(page)).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __writes: unknown[] }).__writes.length)).toBe(1);
  // An editable PNG (the default for an untitled document): the PNG signature.
  expect(await page.evaluate(() => (window as unknown as { __writes: number[][] }).__writes[0])).toEqual([0x89, 0x50, 0x4e, 0x47]);
});
