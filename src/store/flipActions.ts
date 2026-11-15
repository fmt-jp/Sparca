// 左右反転・上下反転 of the selection (model/flip): around the center of everything selected,
// so several objects swap places as a whole. One undo step.
import { flipObject, type FlipAxis } from '../model/flip';
import { objectBounds, type Rect } from '../model/geometry';
import { findObject, isEffectivelyLocked } from '../model/tree';
import type { EditorStore } from './editor';

function targets(ed: EditorStore) {
  const { doc, selection } = ed.getState();
  return selection.map((id) => findObject(doc, id)).filter((l) => l && !isEffectivelyLocked(l)).map((l) => l!.object);
}

export function canFlip(ed: EditorStore): boolean {
  return targets(ed).length > 0;
}

export function flipSelection(ed: EditorStore, axis: FlipAxis): boolean {
  const objs = targets(ed);
  if (!objs.length) {
    ed.notify('error', '反転するオブジェクトを選択してください。');
    return false;
  }
  let u: Rect | null = null;
  for (const o of objs) {
    const r = objectBounds(o);
    if (!r) continue;
    u = u ? union(u, r) : r;
  }
  if (!u) return false;
  const c = { x: u.x + u.width / 2, y: u.y + u.height / 2 };
  ed.edit(axis === 'x' ? '左右反転' : '上下反転', (d) => {
    for (const o of objs) {
      const loc = findObject(d, o.id);
      if (loc) loc.siblings[loc.index] = flipObject(loc.object, axis, c);
    }
  });
  return true;
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
