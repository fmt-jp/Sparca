// Resolves the displayed raster for an image object: the original asset when the
// pipeline is the identity, otherwise the processed result (docs/design.md §4).
import type { ImageObject, ImagePipeline } from '../model/types';
import { assets } from '../store/assets';

export function isIdentityPipeline(p: ImagePipeline): boolean {
  const a = p.adjust;
  return (
    !p.crop &&
    !p.resize &&
    p.blur <= 0 &&
    p.localEdits.length === 0 &&
    a.brightness === 0 &&
    a.contrast === 0 &&
    a.saturation === 0 &&
    a.temperature === 0 &&
    a.tint === 0 &&
    !a.auto
  );
}

type Listener = () => void;

export class ImageRenderCache {
  private listeners = new Set<Listener>();

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  protected changed(): void {
    this.listeners.forEach((l) => l());
  }

  /** URL to display, or undefined while the result is not ready yet. */
  href(o: ImageObject): string | undefined {
    const entry = assets.get(o.assetId);
    if (!entry) return undefined;
    return entry.url;
  }
}

export const imageCache = new ImageRenderCache();
