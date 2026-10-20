/// <reference lib="webworker" />
// Image-processing worker: decodes assets, runs pipelines and encodes results off the UI thread.
import type { ImagePipeline } from '../model/types';
import { computeAutoColor } from './color';
import { runPipeline } from './pipeline';
import { cropRaster, type Raster } from './raster';
import { resample } from './resample';

export type WorkerRequest =
  | { type: 'register'; assetId: string; blob: Blob }
  | { type: 'process'; jobId: number; assetId: string; pipeline: ImagePipeline; scale: number }
  | { type: 'analyze'; jobId: number; assetId: string; crop: ImagePipeline['crop'] };

export type WorkerResponse =
  | { type: 'progress'; jobId: number; fraction: number }
  | { type: 'done'; jobId: number; blob: Blob; width: number; height: number }
  | { type: 'analyzed'; jobId: number; params: ReturnType<typeof computeAutoColor> }
  | { type: 'error'; jobId: number; message: string };

const blobs = new Map<string, Blob>();
const sources = new Map<string, Raster>();
const proxies = new Map<string, Raster>();
const ANALYZE_MAX_SIDE = 512;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

async function decode(assetId: string): Promise<Raster> {
  const cached = sources.get(assetId);
  if (cached) return cached;
  const blob = blobs.get(assetId);
  if (!blob) throw new Error('画像データが登録されていません');
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(bmp, 0, 0);
  bmp.close();
  const img = c.getImageData(0, 0, canvas.width, canvas.height);
  const r: Raster = { width: img.width, height: img.height, data: img.data };
  sources.set(assetId, r);
  return r;
}

async function sourceAt(assetId: string, scale: number): Promise<Raster> {
  const src = await decode(assetId);
  if (scale >= 1) return src;
  const key = `${assetId}@${scale}`;
  let p = proxies.get(key);
  if (!p) {
    p = resample(src, Math.max(1, Math.round(src.width * scale)), Math.max(1, Math.round(src.height * scale)), 'bilinear');
    proxies.set(key, p);
    // Keep only a few proxies per asset.
    if (proxies.size > 8) proxies.delete(proxies.keys().next().value!);
  }
  return p;
}

async function encode(r: Raster): Promise<Blob> {
  const canvas = new OffscreenCanvas(r.width, r.height);
  const c = canvas.getContext('2d')!;
  c.putImageData(new ImageData(r.data as Uint8ClampedArray<ArrayBuffer>, r.width, r.height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'register') {
    if (!blobs.has(msg.assetId)) blobs.set(msg.assetId, msg.blob);
    return;
  }
  try {
    if (msg.type === 'process') {
      const src = await sourceAt(msg.assetId, msg.scale);
      const out = runPipeline(src, msg.pipeline, msg.scale, (fraction) =>
        ctx.postMessage({ type: 'progress', jobId: msg.jobId, fraction } satisfies WorkerResponse),
      );
      const blob = await encode(out);
      ctx.postMessage({ type: 'done', jobId: msg.jobId, blob, width: out.width, height: out.height } satisfies WorkerResponse);
    } else if (msg.type === 'analyze') {
      const full = await decode(msg.assetId);
      const region = msg.crop ? cropRaster(full, msg.crop.x, msg.crop.y, msg.crop.width, msg.crop.height) : full;
      const k = Math.min(1, ANALYZE_MAX_SIDE / Math.max(region.width, region.height));
      const small = k < 1 ? resample(region, region.width * k, region.height * k, 'bilinear') : region;
      ctx.postMessage({ type: 'analyzed', jobId: msg.jobId, params: computeAutoColor(small) } satisfies WorkerResponse);
    }
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      jobId: msg.jobId,
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};
