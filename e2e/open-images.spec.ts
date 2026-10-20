import { expect, test, type Page } from '@playwright/test';
import { disableNativePickers, makeBmp, makeJpeg, makePng, openFile, processedPixels, RED_GIF, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

type Opened = { width: number; height: number; bg: string; title: string; dirty: boolean; img: { id: string; box: { x: number; y: number; width: number; height: number } } };
const opened = (page: Page) =>
  state<Opened>(
    page,
    's => ({ width: s.doc.width, height: s.doc.height, bg: s.doc.background.kind, title: s.fileName, dirty: s.doc !== s.savedDoc, img: s.doc.layers[0].children[0] })',
  );

async function expectOpened(page: Page, w: number, h: number, title: string, color: number[]) {
  await expect.poll(async () => (await opened(page)).width).toBe(w);
  const o = await opened(page);
  expect(o).toMatchObject({ width: w, height: h, bg: 'transparent', title, dirty: false });
  expect(o.img.box).toMatchObject({ x: 0, y: 0, width: w, height: h });
  const px = await processedPixels(page, o.img.id, [[0, 0]]);
  for (let i = 0; i < 3; i++) expect(Math.abs(px.px[0][i] - color[i])).toBeLessThanOrEqual(3);
  await expect(page.locator('.notice.error')).toHaveCount(0);
}

test('opens a PNG as a new document of the same size, keeping transparency', async ({ page }) => {
  await openFile(page, 'icon.png', makePng(30, 20, (x) => (x < 15 ? [0, 128, 0, 255] : [0, 0, 0, 0])), 'image/png');
  await expectOpened(page, 30, 20, 'icon', [0, 128, 0]);
  const px = await processedPixels(page, (await opened(page)).img.id, [[25, 5]]);
  expect(px.px[0][3]).toBe(0);
});

test('opens a JPEG (.jpg / .jpe)', async ({ page }) => {
  const jpg = await makeJpeg(page, 64, 48, '#3366cc');
  await openFile(page, 'photo.jpe', jpg); // no MIME type from the OS: detected by content
  await expectOpened(page, 64, 48, 'photo', [0x33, 0x66, 0xcc]);
});

test('opens a GIF', async ({ page }) => {
  await openFile(page, 'dot.gif', RED_GIF, 'image/gif');
  await expectOpened(page, 1, 1, 'dot', [255, 0, 0]);
});

test('opens a BMP (.bmp / .dib)', async ({ page }) => {
  await openFile(page, 'pic.dib', makeBmp(5, 3, () => [10, 200, 30]));
  await expectOpened(page, 5, 3, 'pic', [10, 200, 30]);
  // Saved projects record the real format.
  expect(await state<string>(page, 's => Object.values(s.doc.assets)[0].mimeType')).toBe('image/bmp');
});

test('opened images can be edited, saved as .sparca and reopened', async ({ page }) => {
  await openFile(page, 'pic.bmp', makeBmp(8, 8, () => [200, 50, 50]));
  await expect.poll(async () => (await opened(page)).width).toBe(8);
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  const dl = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  expect((await dl).suggestedFilename()).toBe('pic.sparca');
});

test('unsupported formats are refused with the reason and leave the document as is', async ({ page }) => {
  await openFile(page, 'scan.tif', Buffer.from('II*\0\x08\0\0\0 not really a tiff'));
  await expect(page.locator('.notice.error')).toContainText('PNG / JPEG / GIF / BMP');
  expect(await state<number>(page, 's => s.doc.width')).toBe(800);
  // Placing an unsupported file is refused the same way.
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+Shift+I');
  await (await chooser).setFiles({ name: 'layers.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: Buffer.from('8BPS....') });
  await expect(page.locator('.notice.error').last()).toContainText('対応していない形式');
});
