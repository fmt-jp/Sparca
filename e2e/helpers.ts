import { deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';

/** Build an RGBA PNG in memory. `pixel(x, y)` returns [r, g, b, a]. */
export function makePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * (width * 4 + 1) + 1 + x * 4;
      const [r, g, b, a] = pixel(x, y);
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c;
}

/** Force the download / <input type=file> fallbacks instead of native file pickers. */
export async function disableNativePickers(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker;
  });
}

export async function canvasBox(page: Page) {
  const b = await page.getByTestId('canvas').boundingBox();
  if (!b) throw new Error('canvas not visible');
  return b;
}

export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

/** Read editor state exposed for tests. */
export function state<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { const s = window.__sparca.getState(); return (${fn})(s); })()`) as Promise<T>;
}

/** Place a generated PNG through the File menu. */
export async function placePng(page: Page, name: string, png: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /画像を配置/ }).click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => {
    const s = (window as unknown as { __sparca: { getState(): { selection: string[] } } }).__sparca.getState();
    return s.selection.length === 1;
  });
}

/**
 * Full-resolution processed pixels of an image object, rendered by the real engine (worker).
 * Returns width, height and an accessor for RGBA at (x, y).
 */
export async function processedPixels(page: Page, id: string, points: [number, number][]) {
  return page.evaluate(
    async ({ id, points }) => {
      const w = window as unknown as {
        __sparca: { getState(): { doc: { layers: { children: { id: string }[] }[] } } };
        __sparcaImages: { fullBlob(o: unknown): Promise<Blob> };
      };
      const o = w.__sparca.getState().doc.layers.flatMap((l) => l.children).find((c) => c.id === id);
      const blob = await w.__sparcaImages.fullBlob(o);
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const px = points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
      return { width: bmp.width, height: bmp.height, px };
    },
    { id, points },
  );
}

export async function waitImagesIdle(page: Page) {
  await page.waitForFunction(() => (window as unknown as { __sparcaImages: { idle: boolean } }).__sparcaImages.idle);
}

/** Decode image bytes in the browser and read pixels at the given points. */
export async function decodePixels(page: Page, bytes: Buffer, mime: string, points: [number, number][]) {
  return page.evaluate(
    async ({ b64, mime, points }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bin], { type: mime }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      return { width: bmp.width, height: bmp.height, px: points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data)) };
    },
    { b64: bytes.toString('base64'), mime, points },
  );
}

/** Build a 24-bit uncompressed BMP. */
export function makeBmp(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const b = Buffer.alloc(size);
  b.write('BM', 0, 'ascii');
  b.writeUInt32LE(size, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(width, 18);
  b.writeInt32LE(height, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(rowSize * height, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize; // bottom-up
    for (let x = 0; x < width; x++) {
      const [r, g, bl] = pixel(x, y);
      b[row + x * 3] = bl;
      b[row + x * 3 + 1] = g;
      b[row + x * 3 + 2] = r;
    }
  }
  return b;
}

/** 1×1 red GIF89a. */
export const RED_GIF = Buffer.from('R0lGODlhAQABAIABAP8AAP///ywAAAAAAQABAAACAkQBADs=', 'base64');

/** Encode a solid-color JPEG in the browser. */
export async function makeJpeg(page: Page, width: number, height: number, color: string): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ({ width, height, color }) => {
      const c = new OffscreenCanvas(width, height);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
      const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
      const bin = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const v of bin) s += String.fromCharCode(v);
      return btoa(s);
    },
    { width, height, color },
  );
  return Buffer.from(b64, 'base64');
}

/** File → 開く with the given file. */
export async function openFile(page: Page, name: string, buffer: Buffer, mimeType = '') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイル' }).click();
  await page.getByRole('menuitem', { name: /開く/ }).click();
  await (await chooser).setFiles({ name, mimeType, buffer });
}

/** Choose a color through the swatch palette by typing its code. */
export async function setColor(page: Page, scope: import('@playwright/test').Locator, label: string, hex: string) {
  await scope.getByRole('button', { name: label, exact: true }).click();
  const code = page.getByRole('dialog', { name: `${label}のパレット` }).getByLabel(`${label}のカラーコード`);
  await code.fill(hex);
  await code.press('Enter');
}
