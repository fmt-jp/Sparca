// ブラシ・鉛筆・消しゴム (decided with the user 2026-11-09): a stroke drawn on the canvas is
// kept on the image as an edit (LocalStroke; the original pixels stay). It goes onto the one
// selected image; with no image selected the brush and pencil draw on a new transparent image
// the size of the canvas (as Fireworks), the eraser asks for an image.
import { pipelineOutputSize } from '../engine/pipeline';
import { createImage } from '../model/factory';
import { selectionToImageMask } from '../model/imageOps';
import { addObject } from '../model/commands';
import { findObject, isEffectivelyLocked } from '../model/tree';
import type { ImageObject, LocalStroke, Point, SparcaDocument, StrokeTool } from '../model/types';
import { importImageFile } from './assets';
import { writableLayer } from './actions';
import type { EditorStore } from './editor';

export const STROKE_TOOLS: ReadonlySet<string> = new Set<StrokeTool>(['brush', 'pencil', 'eraser']);

export const STROKE_LABELS: Record<StrokeTool, string> = { brush: 'ブラシ', pencil: '鉛筆', eraser: '消しゴム' };

/** The one selected image a stroke goes onto (null: none, or something else selected). */
export function strokeTarget(ed: EditorStore): ImageObject | null {
  const { doc, selection } = ed.getState();
  if (selection.length !== 1) return null;
  const loc = findObject(doc, selection[0]);
  return loc?.object.type === 'image' ? loc.object : null;
}

/** Processed-image px per document px of an image (its pipeline's output over its box). */
function pxPerDoc(doc: SparcaDocument, o: ImageObject): number {
  const asset = doc.assets[o.assetId];
  const size = asset ? pipelineOutputSize(o.pipeline, asset.width, asset.height) : o.box;
  return (size.width / o.box.width + size.height / o.box.height) / 2;
}

/** The stroke along `points` (document coordinates) as an edit of image `o`, with the tool's settings. */
function strokeFor(ed: EditorStore, o: ImageObject, tool: StrokeTool, points: Point[]): LocalStroke {
  const s = ed.getState().brushes[tool];
  const shape = selectionToImageMask(o, { kind: 'polygon', points });
  const k = pxPerDoc(ed.getState().doc, o);
  return {
    kind: 'stroke',
    tool,
    points: shape.kind === 'polygon' ? shape.points : [],
    size: Math.max(tool === 'pencil' ? 1 : 0.5, s.size * k),
    hardness: tool === 'pencil' ? 1 : s.hardness,
    color: s.color,
    opacity: s.opacity,
  };
}

/** A transparent PNG of w×h px. */
async function blankPng(w: number, h: number): Promise<Blob> {
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d');
  return c.convertToBlob({ type: 'image/png' });
}

/**
 * Draw a stroke of `tool` along `points` (document coordinates): onto the selected image, or
 * (brush and pencil) onto a new transparent image covering the canvas. One undo step.
 */
export async function commitStroke(ed: EditorStore, tool: StrokeTool, points: Point[]): Promise<boolean> {
  if (!points.length) return false;
  const label = `${STROKE_LABELS[tool]}で${tool === 'eraser' ? '消去' : '描画'}`;
  const target = strokeTarget(ed);
  if (target) {
    const loc = findObject(ed.getState().doc, target.id);
    if (!loc || isEffectivelyLocked(loc)) {
      ed.notify('error', 'ロック中の画像には描けません。');
      return false;
    }
    const stroke = strokeFor(ed, target, tool, points);
    ed.edit(label, (d) => {
      const t = findObject(d, target.id);
      if (t?.object.type === 'image') t.object.pipeline.localEdits.push(stroke);
    });
    return true;
  }
  if (tool === 'eraser') {
    ed.notify('error', '消しゴムで消す画像を選択してください。');
    return false;
  }
  const layerId = writableLayer(ed, ed.getState().activeLayerId);
  if (!layerId) return false;
  const { doc } = ed.getState();
  const w = Math.max(1, Math.round(doc.width));
  const h = Math.max(1, Math.round(doc.height));
  const meta = await importImageFile(await blankPng(w, h), `${STROKE_LABELS[tool]}.png`);
  const img: ImageObject = { ...createImage(meta, { x: 0, y: 0, width: w, height: h, rotation: 0 }), name: STROKE_LABELS[tool] };
  const stroke = strokeFor(ed, img, tool, points);
  img.pipeline = { ...img.pipeline, localEdits: [stroke] };
  ed.edit(label, (d) => {
    d.assets[meta.id] = meta;
    addObject(d, layerId, img, ed.getState().maskEdit);
  });
  // Further strokes go onto it.
  ed.select([img.id]);
  return true;
}
