// SVG export (spec §13.2, future extension → implemented 2026-10-24): the same SVG the
// screen and the raster export use, as a file. Shapes and paths stay vectors, text stays
// text (shown in the viewer's copy of the font), images are embedded (with their color
// adjustments and partial edits applied) and effects are SVG filters.
import { objectBounds, rectsIntersect } from '../model/geometry';
import type { SceneObject, SparcaDocument } from '../model/types';
import { strokeReach } from '../render/DocumentSvg';
import { effectsMargin, splitAtZoomBlur, zoomBlurReach } from '../render/effects';
import { validateDimensions } from '../store/assets';
import { ExportError } from './export';
import { AppUpdatedError, loadRasterize } from '../lazy';

/** Whether an object (with what its stroke and effects add around it) can show on the canvas. */
function reachesCanvas(o: SceneObject, canvas: { width: number; height: number }): boolean {
  const b = objectBounds(o);
  if (!b) return false;
  let m = 0;
  if (o.type !== 'group') {
    m = (o.type === 'shape' || o.type === 'path') && o.stroke ? strokeReach(o) : 0;
    m += effectsMargin(o.effects);
    for (const seg of splitAtZoomBlur(o.effects)) if (seg.zoom) m += zoomBlurReach(seg.zoom, o.box.width, o.box.height);
  }
  return rectsIntersect({ x: b.x - m, y: b.y - m, width: b.width + m * 2, height: b.height + m * 2 }, { x: 0, y: 0, width: canvas.width, height: canvas.height });
}

function keepOnCanvas(objects: SceneObject[], canvas: { width: number; height: number }): SceneObject[] {
  const out: SceneObject[] = [];
  for (const o of objects) {
    if (!o.visible) continue;
    if (o.type === 'group') {
      const children = keepOnCanvas(o.children, canvas);
      if (children.length) out.push({ ...o, children });
    } else if (reachesCanvas(o, canvas)) out.push(o);
  }
  return out;
}

/** The document without hidden layers and objects that cannot show on the canvas. */
export function canvasContent(doc: SparcaDocument): SparcaDocument {
  return { ...doc, layers: doc.layers.filter((l) => l.visible).map((l) => ({ ...l, children: keepOnCanvas(l.children, doc) })) };
}

export async function exportSvg(doc: SparcaDocument): Promise<Blob> {
  const problem = validateDimensions(doc.width, doc.height);
  if (problem) throw new ExportError(problem);
  let r: Awaited<ReturnType<typeof loadRasterize>>;
  try {
    r = await loadRasterize();
  } catch (e) {
    throw new ExportError(e instanceof AppUpdatedError ? e.message : String(e));
  }
  let markup: string;
  try {
    markup = await r.documentSvgMarkup(canvasContent(doc));
  } catch (e) {
    throw new ExportError(e instanceof r.RenderError ? e.message : `描画に失敗しました: ${String(e)}`);
  }
  return new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', markup, '\n'], { type: 'image/svg+xml' });
}
