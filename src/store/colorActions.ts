// Eyedropper (spec §8.3): sample the composited canvas and apply the color to the selection.
import { updateObject } from '../model/commands';
import { findObject, isEffectivelyLocked } from '../model/tree';
import type { SceneObject, SparcaDocument } from '../model/types';
import type { EditorStore } from './editor';
import { AppUpdatedError, loadRasterize } from '../lazy';

let cached: { doc: SparcaDocument; ctx: CanvasRenderingContext2D } | null = null;

export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Color of the composited document at (x, y), or null for transparent / outside the canvas. */
export async function sampleColor(doc: SparcaDocument, x: number, y: number): Promise<string | null> {
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
  if (!cached || cached.doc !== doc) {
    const { rasterizeDocument } = await loadRasterize();
    const canvas = await rasterizeDocument(doc);
    cached = { doc, ctx: canvas.getContext('2d', { willReadFrequently: true })! };
  }
  const [r, g, b, a] = cached.ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
  if (a === 0) return null;
  return toHex(r, g, b);
}

/** Apply a color to the selected objects: fill/stroke for shapes and paths, color for text. */
export function applyColorToSelection(ed: EditorStore, color: string): number {
  const { doc, selection, eyedropperTarget } = ed.getState();
  const targets: SceneObject[] = [];
  const collect = (o: SceneObject) => {
    if (o.type === 'group') o.children.forEach(collect);
    else if (o.type !== 'image') targets.push(o);
  };
  for (const id of selection) {
    const loc = findObject(doc, id);
    if (loc && !isEffectivelyLocked(loc)) collect(loc.object);
  }
  if (!targets.length) return 0;
  ed.edit('スポイトで色を設定', (d) => {
    for (const o of targets) {
      if (o.type === 'text') updateObject(d, o.id, { color } as Partial<SceneObject>);
      else if (o.type === 'shape' || o.type === 'path') {
        const lineLike = o.type === 'shape' ? o.shape.kind === 'line' || o.shape.kind === 'arrow' : !o.closed;
        if (eyedropperTarget === 'stroke' || lineLike) {
          updateObject(d, o.id, { stroke: color, strokeWidth: o.strokeWidth || 2 } as Partial<SceneObject>);
        } else updateObject(d, o.id, { fill: color } as Partial<SceneObject>);
      }
    }
  });
  return targets.length;
}

export async function pickColorAt(ed: EditorStore, x: number, y: number): Promise<void> {
  try {
    const color = await sampleColor(ed.getState().doc, x, y);
    if (!color) {
      ed.notify('info', 'キャンバスの外、または透明な部分です。色を取得できませんでした。');
      return;
    }
    ed.set({ pickedColor: color });
    const n = applyColorToSelection(ed, color);
    if (n === 0) ed.notify('info', `色 ${color} を取得しました。図形やテキストを選択してからクリックすると適用されます。`);
  } catch (e) {
    ed.notify('error', e instanceof AppUpdatedError ? e.message : `色の取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  }
}
