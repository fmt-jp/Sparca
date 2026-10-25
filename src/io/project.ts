// .hnb project format (HANABI): ZIP with document.json + assets/<id>.<ext> (docs/design.md §6).
import JSZip from 'jszip';
import { referencedAssets } from '../model/tree';
import { MAX_DIMENSION, MAX_PIXELS, type AssetId, type SparcaDocument } from '../model/types';
import { IMAGE_FORMATS, sniffImageFormat } from './imageFormats';
import { validateDocument } from './validate';

export const PROJECT_EXTENSION = '.hnb';
export const PROJECT_MIME = 'application/x-hanabi';

export class ProjectError extends Error {}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

function assetPath(id: AssetId, mime: string): string {
  return `assets/${id}.${EXT[mime] ?? 'bin'}`;
}

/** Serialize a document. `getAsset` returns the original bytes of an asset. */
export async function writeProject(
  doc: SparcaDocument,
  getAsset: (id: AssetId) => Blob | undefined,
): Promise<Uint8Array> {
  const zip = new JSZip();
  const used = referencedAssets(doc);
  // Only keep metadata for assets the document still references.
  const assets: SparcaDocument['assets'] = {};
  for (const id of used) {
    const meta = doc.assets[id];
    const blob = getAsset(id);
    if (!meta || !blob) throw new ProjectError(`画像データ（${id}）が見つからないため保存できません。`);
    assets[id] = meta;
    zip.file(assetPath(id, meta.mimeType), new Uint8Array(await blob.arrayBuffer()));
  }
  const json = JSON.stringify({ format: 'hanabi', ...doc, assets }, null, 2);
  zip.file('document.json', json);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export interface LoadedProject {
  doc: SparcaDocument;
  assets: Map<AssetId, Blob>;
}

/**
 * Size limits when opening a project, so a crafted file (e.g. a "ZIP bomb": tiny when
 * compressed, huge when expanded) fails with a message instead of exhausting memory.
 * Generous for real work: images are at most 100 megapixels.
 */
export interface ReadLimits {
  /** The .hnb file itself. */
  fileBytes: number;
  /** Expanded document.json. */
  jsonBytes: number;
  /** One expanded image. */
  assetBytes: number;
  /** All expanded images together. */
  totalAssetBytes: number;
}

const MB = 1024 * 1024;
export const READ_LIMITS: ReadLimits = { fileBytes: 2048 * MB, jsonBytes: 64 * MB, assetBytes: 512 * MB, totalAssetBytes: 2048 * MB };

const tooLarge = (what: string, limit: number) =>
  new ProjectError(`${what}が大きすぎるため開けません（上限 ${Math.round(limit / MB).toLocaleString()} MB）。ファイルが壊れているか、HANABI で保存したファイルではない可能性があります。`);

/** Expanded size recorded in the ZIP directory (not trusted: the read below checks too). */
function declaredSize(f: JSZip.JSZipObject): number | undefined {
  return (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
}

interface ZipStream {
  on(event: 'data', fn: (chunk: Uint8Array) => void): ZipStream;
  on(event: 'error', fn: (e: Error) => void): ZipStream;
  on(event: 'end', fn: () => void): ZipStream;
  pause(): ZipStream;
  resume(): ZipStream;
}

/** Expand one ZIP entry, giving up as soon as it grows past `limit` bytes. */
function readLimited(f: JSZip.JSZipObject, limit: number, what: string): Promise<Uint8Array> {
  const declared = declaredSize(f);
  if (declared !== undefined && declared > limit) return Promise.reject(tooLarge(what, limit));
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    // ZipObject#internalStream (documented in JSZip 3, missing from its type definitions).
    const stream = (f as unknown as { internalStream(type: 'uint8array'): ZipStream }).internalStream('uint8array');
    stream.on('data', (chunk: Uint8Array) => {
      if (settled) return;
      total += chunk.length;
      if (total > limit) {
        settled = true;
        stream.pause();
        reject(tooLarge(what, limit));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', (e: Error) => {
      if (settled) return;
      settled = true;
      reject(new ProjectError(`${what}を展開できません（ファイルが壊れています）: ${e.message}`));
    });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      const out = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      resolve(out);
    });
    stream.resume();
  });
}

const ALLOWED_MIME = new Set(IMAGE_FORMATS.map((f) => f.mime));

/** Parse and validate a project file. Throws ProjectError with a user-facing reason. */
export async function readProject(data: ArrayBuffer | Uint8Array, limits: ReadLimits = READ_LIMITS): Promise<LoadedProject> {
  if (data.byteLength > limits.fileBytes) throw tooLarge('ファイル', limits.fileBytes);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new ProjectError('HANABI プロジェクトファイルとして読み込めません（ZIP 形式ではないか、ファイルが壊れています）。');
  }
  const entry = zip.file('document.json');
  if (!entry) throw new ProjectError('プロジェクトファイルに document.json がありません。');
  let raw: unknown;
  const json = await readLimited(entry, limits.jsonBytes, 'document.json ');
  try {
    raw = JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new ProjectError('document.json の内容が JSON として正しくありません。');
  }
  const result = validateDocument(raw);
  if (!result.ok) throw new ProjectError(`プロジェクトの内容が正しくありません: ${result.error}`);
  const doc = result.doc;
  const assets = new Map<AssetId, Blob>();
  let total = 0;
  for (const id of referencedAssets(doc)) {
    const meta = doc.assets[id];
    if (!meta) throw new ProjectError(`画像 ${id} の情報がありません。`);
    const name = meta.fileName || id;
    // Only the raster formats HANABI itself stores, with sizes it could have created.
    if (!ALLOWED_MIME.has(meta.mimeType)) throw new ProjectError(`画像「${name}」の形式（${meta.mimeType}）には対応していません。`);
    if (!(meta.width >= 1 && meta.height >= 1 && meta.width <= MAX_DIMENSION && meta.height <= MAX_DIMENSION && meta.width * meta.height <= MAX_PIXELS)) {
      throw new ProjectError(`画像「${name}」の大きさ（${meta.width}×${meta.height}）が正しくありません。`);
    }
    const file = zip.file(assetPath(id, meta.mimeType));
    if (!file) throw new ProjectError(`画像「${name}」のデータがプロジェクト内にありません。`);
    const bytes = await readLimited(file, Math.min(limits.assetBytes, limits.totalAssetBytes - total), `画像「${name}」`);
    total += bytes.length;
    // The data must really be an image of the recorded format.
    if (sniffImageFormat(bytes)?.mime !== meta.mimeType) throw new ProjectError(`画像「${name}」のデータが ${meta.mimeType} の画像ではありません。`);
    assets.set(id, new Blob([bytes as BlobPart], { type: meta.mimeType }));
  }
  return { doc, assets };
}
