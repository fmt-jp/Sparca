// Composite the document (canvas area only) into pixels using the same SVG renderer as the
// screen (docs/design.md §3). Used by export and the eyedropper.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { allObjects } from '../model/tree';
import type { ImageObject, SparcaDocument } from '../model/types';
import { DocumentSvg } from './DocumentSvg';
import { imageCache } from './imageCache';

export class RenderError extends Error {}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('読み込みに失敗しました'));
    r.readAsDataURL(blob);
  });
}

/** Image types every SVG viewer shows as a still image; others (BMP, possibly animated GIF) become PNG. */
const PORTABLE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

async function portableImage(blob: Blob): Promise<Blob> {
  if (PORTABLE_IMAGE_TYPES.includes(blob.type)) return blob;
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return c.convertToBlob({ type: 'image/png' });
}

/** Standalone SVG markup of the document with every image embedded as a data URL. */
export async function documentSvgMarkup(doc: SparcaDocument, scale = 1): Promise<string> {
  const hrefs = new Map<string, string>();
  for (const o of allObjects(doc)) {
    if (o.type !== 'image' || !o.visible) continue;
    try {
      hrefs.set(o.id, await blobToDataUrl(await portableImage(await imageCache.fullBlob(o))));
    } catch (e) {
      throw new RenderError(`画像「${o.name}」の処理に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const el = createElement(DocumentSvg, {
    doc,
    width: Math.round(doc.width * scale),
    height: Math.round(doc.height * scale),
    forExport: true,
    options: { imageHref: (o: ImageObject) => hrefs.get(o.id), idPrefix: 'export' },
  });
  return renderToStaticMarkup(el);
}

/** Render the canvas area into a 2D canvas. `background` fills transparent areas (e.g. for JPEG). */
export async function rasterizeDocument(doc: SparcaDocument, opts: { scale?: number; background?: string | null } = {}): Promise<HTMLCanvasElement> {
  const scale = opts.scale ?? 1;
  const w = Math.max(1, Math.round(doc.width * scale));
  const h = Math.max(1, Math.round(doc.height * scale));
  const markup = await documentSvgMarkup(doc, scale);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new RenderError('ドキュメントの描画に失敗しました。'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new RenderError('描画用のキャンバスを作成できませんでした（画像が大きすぎる可能性があります）。');
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
