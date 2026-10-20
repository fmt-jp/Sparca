// .sparca project format: ZIP with document.json + assets/<id>.<ext> (docs/design.md §6).
import JSZip from 'jszip';
import { referencedAssets } from '../model/tree';
import type { AssetId, SparcaDocument } from '../model/types';
import { validateDocument } from './validate';

export const PROJECT_EXTENSION = '.sparca';
export const PROJECT_MIME = 'application/x-sparca';

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
  const json = JSON.stringify({ format: 'sparca', ...doc, assets }, null, 2);
  zip.file('document.json', json);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export interface LoadedProject {
  doc: SparcaDocument;
  assets: Map<AssetId, Blob>;
}

/** Parse and validate a project file. Throws ProjectError with a user-facing reason. */
export async function readProject(data: ArrayBuffer | Uint8Array): Promise<LoadedProject> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new ProjectError('Sparca プロジェクトファイルとして読み込めません（ZIP 形式ではないか、ファイルが壊れています）。');
  }
  const entry = zip.file('document.json');
  if (!entry) throw new ProjectError('プロジェクトファイルに document.json がありません。');
  let raw: unknown;
  try {
    raw = JSON.parse(await entry.async('string'));
  } catch {
    throw new ProjectError('document.json の内容が JSON として正しくありません。');
  }
  const result = validateDocument(raw);
  if (!result.ok) throw new ProjectError(`プロジェクトの内容が正しくありません: ${result.error}`);
  const doc = result.doc;
  const assets = new Map<AssetId, Blob>();
  for (const id of referencedAssets(doc)) {
    const meta = doc.assets[id];
    if (!meta) throw new ProjectError(`画像 ${id} の情報がありません。`);
    const file = zip.file(assetPath(id, meta.mimeType));
    if (!file) throw new ProjectError(`画像「${meta.fileName || id}」のデータがプロジェクト内にありません。`);
    const bytes = await file.async('uint8array');
    assets.set(id, new Blob([bytes as BlobPart], { type: meta.mimeType }));
  }
  return { doc, assets };
}
