// 自動選択ツール (decided with the user 2026-11-15): a click selects the area whose color is
// like the clicked point's, judged on what the canvas shows (everything composited, as
// exported). Settings: tolerance and 隣接 (connected only). Shift+click adds to the selection.
// The area becomes a pixel selection outlined as polygons (holes and parts included), with the
// selection tools' edge setting.
import { loadRasterize } from '../lazy';
import { traceOutlines } from '../engine/trace';
import { rasterizeMask } from '../engine/mask';
import { similarRegion } from '../engine/wand';
import type { MaskShape, Point } from '../model/types';
import type { EditorStore } from './editor';

export interface WandSettings {
  /** 0..255: how far each channel may differ from the clicked color. */
  tolerance: number;
  /** Only the area connected to the clicked point (else like colors anywhere). */
  contiguous: boolean;
}

export const DEFAULT_WAND: WandSettings = { tolerance: 32, contiguous: true };

/** A shape in document coordinates as one normalized to a w×h canvas. */
function normalized(s: MaskShape, w: number, h: number): MaskShape {
  if (s.kind === 'polygon') {
    const map = (ps: Point[]) => ps.map((p) => ({ x: p.x / w, y: p.y / h }));
    return { ...s, points: map(s.points), ...(s.more ? { more: s.more.map(map) } : {}) };
  }
  return { ...s, x: s.x / w, y: s.y / h, width: s.width / w, height: s.height / h };
}

export async function magicWand(ed: EditorStore, at: Point, add: boolean): Promise<boolean> {
  const { doc, wand, pixelSelection } = ed.getState();
  const x = Math.floor(at.x);
  const y = Math.floor(at.y);
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return false;
  ed.set({ busy: '自動選択中…' });
  try {
    const { rasterizeDocument } = await loadRasterize();
    const canvas = await rasterizeDocument(doc);
    const w = canvas.width;
    const h = canvas.height;
    const data = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
    const region = similarRegion(data, w, h, x, y, wand.tolerance, wand.contiguous);
    if (add && pixelSelection) {
      // Shift: together with what is already selected (its plain shape).
      const plain = { ...pixelSelection, grow: 0, feather: 0, antialias: true };
      const had = rasterizeMask(normalized(plain, w, h), w, h);
      for (let i = 0; i < region.length; i++) if (had[i] >= 0.5) region[i] = 255;
    }
    // Halfway between 0 and 255, so the outline runs exactly along pixel edges; one pixel still counts.
    const loops = traceOutlines(region, w, h, 127.5, 0.5, 0.5);
    if (!loops.length) return false;
    const [first, ...more] = loops;
    // The new area takes the tools' edge setting (setPixelSelection), like the other tools.
    ed.setPixelSelection({ kind: 'polygon', points: first, ...(more.length ? { more } : {}) });
    return true;
  } catch (e) {
    ed.notify('error', `自動選択に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    ed.set({ busy: null });
  }
}
