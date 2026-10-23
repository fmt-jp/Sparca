// Non-destructive raster pipeline (docs/design.md §4):
// crop → resize → color adjust → local (masked) edits: blur / mosaic. (Whole-object blur is an effect.)
import type { ImagePipeline } from '../model/types';
import { blendWithMask, gaussianBlur, mosaic } from './blur';
import { applyAdjust, isIdentityAdjust } from './color';
import { rasterizeMask } from './mask';
import { cropRaster, type Raster } from './raster';
import { resample } from './resample';

/** Output pixel size of a pipeline applied to a source of the given size. */
export function pipelineOutputSize(p: ImagePipeline, srcW: number, srcH: number): { width: number; height: number } {
  if (p.resize) return { width: p.resize.width, height: p.resize.height };
  if (p.crop) return { width: Math.round(p.crop.width), height: Math.round(p.crop.height) };
  return { width: srcW, height: srcH };
}

/**
 * Run the pipeline. `scale` (≤1) is used for fast previews: `src` is then a copy of the
 * source already downscaled by `scale`, and every pixel-sized parameter is scaled to match.
 */
export function runPipeline(src: Raster, p: ImagePipeline, scale = 1, onProgress?: (f: number) => void): Raster {
  let img = src;
  const steps = 2 + (isIdentityAdjust(p.adjust) ? 0 : 1) + p.localEdits.length;
  let done = 0;
  const tick = () => onProgress?.(++done / steps);

  if (p.crop) {
    img = cropRaster(img, p.crop.x * scale, p.crop.y * scale, p.crop.width * scale, p.crop.height * scale);
  }
  tick();
  if (p.resize) {
    const w = Math.max(1, Math.round(p.resize.width * scale));
    const h = Math.max(1, Math.round(p.resize.height * scale));
    if (w !== img.width || h !== img.height) img = resample(img, w, h, p.resize.method);
  }
  tick();
  if (!isIdentityAdjust(p.adjust)) {
    img = applyAdjust(img, p.adjust);
    tick();
  }
  for (const edit of p.localEdits) {
    const mask = rasterizeMask(edit.mask, img.width, img.height, scale);
    const processed = edit.kind === 'mosaic' ? mosaic(img, edit.size * scale) : gaussianBlur(img, edit.radius * scale);
    img = blendWithMask(img, processed, mask);
    tick();
  }
  return img;
}
