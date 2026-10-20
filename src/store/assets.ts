// Immutable raster assets (docs/design.md §2.2). The document only stores ids + metadata.
import { sniffImageFormat, SUPPORTED_LABEL } from '../io/imageFormats';
import { newId } from '../model/factory';
import { MAX_DIMENSION, MAX_PIXELS, type AssetId, type AssetMeta } from '../model/types';

export interface AssetEntry {
  meta: AssetMeta;
  blob: Blob;
  url: string;
}

export class AssetStore {
  private entries = new Map<AssetId, AssetEntry>();

  get(id: AssetId): AssetEntry | undefined {
    return this.entries.get(id);
  }

  has(id: AssetId): boolean {
    return this.entries.has(id);
  }

  put(meta: AssetMeta, blob: Blob): AssetEntry {
    const existing = this.entries.get(meta.id);
    if (existing) return existing;
    const entry = { meta, blob, url: URL.createObjectURL(blob) };
    this.entries.set(meta.id, entry);
    return entry;
  }

  /** Release every asset (used when a different document is opened). */
  clear(): void {
    for (const e of this.entries.values()) URL.revokeObjectURL(e.url);
    this.entries.clear();
  }
}

export const assets = new AssetStore();

export class ImageLoadError extends Error {}

export function validateDimensions(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return '幅と高さは 1px 以上の数値で指定してください。';
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return `一辺の最大サイズは ${MAX_DIMENSION}px です（指定: ${Math.round(width)}×${Math.round(height)}px）。`;
  }
  if (width * height > MAX_PIXELS) {
    return `画素数が上限（${(MAX_PIXELS / 1e6).toFixed(0)}メガピクセル）を超えています。`;
  }
  return null;
}

/** Decode an image file and register it as an asset. Throws ImageLoadError with a user-facing message. */
export async function importImageFile(file: Blob, fileName: string, store = assets, id = newId('a')): Promise<AssetMeta> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const format = sniffImageFormat(head);
  if (!format) {
    throw new ImageLoadError(`「${fileName}」は対応していない形式です。読み込めるのは ${SUPPORTED_LABEL} 画像です。`);
  }
  // Re-type the blob so saved projects record the real format.
  const typed = file.type === format.mime ? file : new Blob([file], { type: format.mime });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(typed);
  } catch {
    throw new ImageLoadError(`「${fileName}」を ${format.label} 画像として読み込めませんでした。ファイルが壊れている可能性があります。`);
  }
  const { width, height } = bitmap;
  bitmap.close();
  const problem = validateDimensions(width, height);
  if (problem) throw new ImageLoadError(`「${fileName}」を読み込めません。${problem}`);
  const meta: AssetMeta = { id, mimeType: format.mime, width, height, fileName };
  store.put(meta, typed);
  return meta;
}
