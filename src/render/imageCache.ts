// Resolves the displayed raster for an image object (docs/design.md §4):
// the original asset when the pipeline is the identity, otherwise the processed result.
// Processing runs in a worker. While parameters change, a downscaled preview is computed
// first; the full-resolution result follows once the parameters stay unchanged.
import type { AutoColorParams, ImageObject, ImagePipeline } from '../model/types';
import type { WorkerRequest, WorkerResponse } from '../engine/worker';
import { pipelineOutputSize } from '../engine/pipeline';
import { assets } from '../store/assets';

export function isIdentityPipeline(p: ImagePipeline): boolean {
  const a = p.adjust;
  return (
    !p.crop &&
    !p.resize &&
    p.localEdits.length === 0 &&
    a.brightness === 0 &&
    a.contrast === 0 &&
    a.saturation === 0 &&
    a.temperature === 0 &&
    a.tint === 0 &&
    !a.auto
  );
}

/** Longest side of preview renders, in output pixels. */
const PREVIEW_MAX_SIDE = 1024;
const FULL_DELAY_MS = 350;
const MAX_RESULTS = 40;

interface Result {
  url: string;
  blob: Blob;
  full: boolean;
}

interface Job {
  key: string;
  assetId: string;
  pipeline: ImagePipeline;
  scale: number;
  full: boolean;
  objectId: string | null;
  waiters: { resolve: (r: Result) => void; reject: (e: Error) => void }[];
}

type Listener = () => void;

export class ImageRenderCache {
  private listeners = new Set<Listener>();
  private worker: Worker | null = null;
  private registered = new Set<string>();
  private results = new Map<string, Result>();
  private lastShown = new Map<string, string>();
  private queue: Job[] = [];
  private running: (Job & { jobId: number }) | null = null;
  private jobSeq = 0;
  private analyzeWaiters = new Map<number, { resolve: (p: AutoColorParams) => void; reject: (e: Error) => void }>();
  private fullTimers = new Map<string, number>();
  /** Pipelines that failed to process; not retried, so the user is told once. */
  private failed = new Set<string>();
  private errorHandler: ((message: string) => void) | null = null;
  /** Progress of the running full-resolution job (0..1), or null. */
  progress: number | null = null;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  onError(fn: (message: string) => void): void {
    this.errorHandler = fn;
  }

  private changed(): void {
    this.listeners.forEach((l) => l());
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
    }
    return this.worker;
  }

  private post(msg: WorkerRequest): void {
    this.getWorker().postMessage(msg);
  }

  private ensureRegistered(assetId: string): boolean {
    if (this.registered.has(assetId)) return true;
    const entry = assets.get(assetId);
    if (!entry) return false;
    this.post({ type: 'register', assetId, blob: entry.blob });
    this.registered.add(assetId);
    return true;
  }

  private signature(assetId: string, p: ImagePipeline): string {
    return `${assetId}|${JSON.stringify(p)}`;
  }

  private key(assetId: string, p: ImagePipeline, full: boolean): string {
    return `${full ? 'full' : 'preview'}|${this.signature(assetId, p)}`;
  }

  private previewScale(assetId: string, p: ImagePipeline): number {
    const meta = assets.get(assetId)?.meta;
    if (!meta) return 1;
    const out = pipelineOutputSize(p, meta.width, meta.height);
    const k = PREVIEW_MAX_SIDE / Math.max(out.width, out.height);
    // Snap to powers of two so proxies can be reused across small parameter changes.
    return k >= 1 ? 1 : 2 ** Math.floor(Math.log2(k));
  }

  /** URL to display, or undefined while nothing is ready yet. Schedules work as needed. */
  href(o: ImageObject, original = false): string | undefined {
    const entry = assets.get(o.assetId);
    if (!entry) return undefined;
    if (original || isIdentityPipeline(o.pipeline)) return entry.url;
    if (this.failed.has(this.signature(o.assetId, o.pipeline))) return this.lastShown.get(o.id);
    const full = this.results.get(this.key(o.assetId, o.pipeline, true));
    if (full) return this.show(o.id, full.url);
    const scale = this.previewScale(o.assetId, o.pipeline);
    if (scale >= 1) {
      this.enqueue(o.assetId, o.pipeline, 1, true, o.id);
      return this.lastShown.get(o.id);
    }
    const preview = this.results.get(this.key(o.assetId, o.pipeline, false));
    if (preview) {
      this.scheduleFull(o);
      return this.show(o.id, preview.url);
    }
    this.enqueue(o.assetId, o.pipeline, scale, false, o.id);
    this.scheduleFull(o);
    return this.lastShown.get(o.id);
  }

  private show(objectId: string, url: string): string {
    this.lastShown.set(objectId, url);
    return url;
  }

  private scheduleFull(o: ImageObject): void {
    const prev = this.fullTimers.get(o.id);
    if (prev !== undefined) clearTimeout(prev);
    const { assetId, pipeline } = o;
    this.fullTimers.set(
      o.id,
      window.setTimeout(() => {
        this.fullTimers.delete(o.id);
        this.enqueue(assetId, pipeline, 1, true, o.id);
      }, FULL_DELAY_MS),
    );
  }

  /** Full-resolution result as a blob (used for export). */
  fullBlob(o: ImageObject): Promise<Blob> {
    const entry = assets.get(o.assetId);
    if (!entry) return Promise.reject(new Error('画像データが見つかりません'));
    if (isIdentityPipeline(o.pipeline)) return Promise.resolve(entry.blob);
    const done = this.results.get(this.key(o.assetId, o.pipeline, true));
    if (done) return Promise.resolve(done.blob);
    return new Promise((resolve, reject) => {
      const job = this.enqueue(o.assetId, o.pipeline, 1, true, null);
      job?.waiters.push({ resolve: (r) => resolve(r.blob), reject });
    });
  }

  /** Analyze the (cropped) source image for auto color. */
  analyzeAuto(o: ImageObject): Promise<AutoColorParams> {
    if (!this.ensureRegistered(o.assetId)) return Promise.reject(new Error('画像データが見つかりません'));
    const jobId = ++this.jobSeq;
    return new Promise((resolve, reject) => {
      this.analyzeWaiters.set(jobId, { resolve, reject });
      this.post({ type: 'analyze', jobId, assetId: o.assetId, crop: o.pipeline.crop });
    });
  }

  private enqueue(assetId: string, pipeline: ImagePipeline, scale: number, full: boolean, objectId: string | null): Job | null {
    if (!this.ensureRegistered(assetId)) return null;
    const key = this.key(assetId, pipeline, full);
    if (this.running?.key === key) return this.running;
    const existing = this.queue.find((j) => j.key === key);
    if (existing) return existing;
    // Latest wins: drop queued work for the same object that nobody waits for.
    if (objectId) this.queue = this.queue.filter((j) => j.objectId !== objectId || j.waiters.length > 0);
    const job: Job = { key, assetId, pipeline, scale, full, objectId, waiters: [] };
    // Previews jump ahead of full-resolution renders.
    if (full) this.queue.push(job);
    else this.queue.unshift(job);
    // href() runs during React render; start work (and notify listeners) afterwards.
    queueMicrotask(() => this.pump());
    return job;
  }

  private pump(): void {
    if (this.running || !this.queue.length) return;
    const job = this.queue.shift()!;
    const jobId = ++this.jobSeq;
    this.running = { ...job, jobId };
    if (job.full) {
      this.progress = 0;
      this.changed();
    }
    this.post({ type: 'process', jobId, assetId: job.assetId, pipeline: job.pipeline, scale: job.scale });
  }

  private onMessage(msg: WorkerResponse): void {
    if (msg.type === 'analyzed' || (msg.type === 'error' && this.analyzeWaiters.has(msg.jobId))) {
      const w = this.analyzeWaiters.get(msg.jobId);
      this.analyzeWaiters.delete(msg.jobId);
      if (msg.type === 'analyzed') w?.resolve(msg.params);
      else w?.reject(new Error(msg.message));
      return;
    }
    const job = this.running;
    if (!job || job.jobId !== msg.jobId) return;
    if (msg.type === 'progress') {
      if (job.full) {
        this.progress = msg.fraction;
        this.changed();
      }
      return;
    }
    this.running = null;
    this.progress = null;
    if (msg.type === 'done') {
      const result: Result = { url: URL.createObjectURL(msg.blob), blob: msg.blob, full: job.full };
      this.results.set(job.key, result);
      this.evict();
      job.waiters.forEach((w) => w.resolve(result));
    } else if (msg.type === 'error') {
      const err = new Error(`画像処理に失敗しました: ${msg.message}`);
      job.waiters.forEach((w) => w.reject(err));
      const sig = this.signature(job.assetId, job.pipeline);
      if (!this.failed.has(sig)) {
        this.failed.add(sig);
        // Drop the pending full-resolution render of the same parameters.
        this.queue = this.queue.filter((j) => this.signature(j.assetId, j.pipeline) !== sig || j.waiters.length > 0);
        if (job.objectId) {
          clearTimeout(this.fullTimers.get(job.objectId));
          this.fullTimers.delete(job.objectId);
        }
        this.errorHandler?.(`${err.message}。元に戻す（Ctrl+Z）で直前の状態に戻せます。`);
      }
    }
    this.changed();
    this.pump();
  }

  private evict(): void {
    if (this.results.size <= MAX_RESULTS) return;
    const inUse = new Set(this.lastShown.values());
    for (const [k, r] of this.results) {
      if (this.results.size <= MAX_RESULTS) break;
      if (inUse.has(r.url)) continue;
      URL.revokeObjectURL(r.url);
      this.results.delete(k);
    }
  }

  /** True while work is pending (used by tests and the status bar). */
  get idle(): boolean {
    return !this.running && this.queue.length === 0 && this.fullTimers.size === 0;
  }
}

export const imageCache = new ImageRenderCache();
