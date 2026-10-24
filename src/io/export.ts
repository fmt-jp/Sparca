// Image export (spec §13.2): the canvas area composited into PNG, JPEG or WebP, or as SVG.
import type { SparcaDocument } from '../model/types';
import { validateDimensions } from '../store/assets';

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'svg';

export const FORMAT_INFO: Record<ExportFormat, { label: string; mime: string; ext: string; lossy: boolean; alpha: boolean }> = {
  png: { label: 'PNG', mime: 'image/png', ext: 'png', lossy: false, alpha: true },
  jpeg: { label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', lossy: true, alpha: false },
  webp: { label: 'WebP', mime: 'image/webp', ext: 'webp', lossy: true, alpha: true },
  svg: { label: 'SVG', mime: 'image/svg+xml', ext: 'svg', lossy: false, alpha: true },
};

export interface ExportOptions {
  format: ExportFormat;
  /** 0..100, used by JPEG and WebP. */
  quality: number;
  /** Fill for transparent areas in JPEG (which has no alpha). */
  jpegBackground: string;
}

export class ExportError extends Error {}

/** Background used to flatten transparency for formats without alpha. */
export function flattenColor(opts: ExportOptions): string | null {
  if (FORMAT_INFO[opts.format].alpha) return null;
  return opts.jpegBackground;
}

export async function exportImage(doc: SparcaDocument, opts: ExportOptions): Promise<Blob> {
  if (opts.format === 'svg') return (await import('./svgExport')).exportSvg(doc);
  const problem = validateDimensions(doc.width, doc.height);
  if (problem) throw new ExportError(problem);
  const info = FORMAT_INFO[opts.format];
  // Loaded on demand: the rasterizer pulls in react-dom/server.
  const { rasterizeDocument, RenderError } = await import('../render/rasterize');
  let canvas: HTMLCanvasElement;
  try {
    canvas = await rasterizeDocument(doc, { background: flattenColor(opts) });
  } catch (e) {
    throw new ExportError(e instanceof RenderError ? e.message : `描画に失敗しました: ${String(e)}`);
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, info.mime, info.lossy ? Math.min(1, Math.max(0, opts.quality / 100)) : undefined),
  );
  if (!blob) throw new ExportError(`${info.label} への変換に失敗しました（画像が大きすぎる可能性があります）。`);
  // Browsers fall back to PNG for formats they cannot encode.
  if (blob.type !== info.mime) {
    throw new ExportError(`このブラウザは ${info.label} の書き出しに対応していません。PNG または JPEG を選んでください。`);
  }
  return blob;
}
