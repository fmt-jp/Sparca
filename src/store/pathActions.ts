// Anchor-level editing of the selected path (subselect tool).
import { removeObjects, updateObject } from '../model/commands';
import {
  deleteAnchors,
  docToPath,
  isSmooth,
  makeCorner,
  makeSmooth,
  moveAnchors,
  pathToDoc,
  splitSegment,
  type DocNode,
} from '../model/pathEdit';
import { findObject, isEffectivelyLocked } from '../model/tree';
import type { Id, PathNode, PathObject, SceneObject, ShapeObject } from '../model/types';
import type { EditorStore } from './editor';

/** A straight line shape as an equivalent open path with two anchors (same id, box, paint and effects). */
export function lineToPath(o: ShapeObject): PathObject | null {
  if (o.shape.kind !== 'line') return null;
  const node = (anchor: { x: number; y: number }): PathNode => ({ anchor: { ...anchor }, in: null, out: null });
  const { shape: _shape, type: _type, ...rest } = o;
  return { ...rest, type: 'path', nodes: [node(o.shape.from), node(o.shape.to)], closed: false };
}

/** Whether the object is a line shape (older documents) that anchor editing turns into a path. */
export function isLineShape(o: SceneObject | undefined): o is ShapeObject {
  return o?.type === 'shape' && o.shape.kind === 'line';
}

/**
 * Lines drawn before lines became paths (2026-10-24) are line shapes: turn the single
 * selected one into a path so its anchors can be edited. One undo step.
 */
export function editLineAsPath(ed: EditorStore): boolean {
  const { doc, selection } = ed.getState();
  if (selection.length !== 1) return false;
  const loc = findObject(doc, selection[0]);
  if (!loc || !isLineShape(loc.object) || isEffectivelyLocked(loc)) return false;
  const path = lineToPath(loc.object)!;
  ed.edit('パスに変換', (d) => {
    const l = findObject(d, path.id);
    if (l) l.siblings[l.index] = path;
  });
  return true;
}

/** The selected path if exactly one editable path is selected. */
export function editablePath(ed: EditorStore): PathObject | null {
  const { doc, selection } = ed.getState();
  if (selection.length !== 1) return null;
  const loc = findObject(doc, selection[0]);
  if (!loc || loc.object.type !== 'path' || isEffectivelyLocked(loc)) return null;
  return loc.object;
}

/** Selected anchor indices, clamped to the path's current node count (undo can remove nodes). */
export function selectedNodes(ed: EditorStore, p: PathObject): number[] {
  return ed.getState().nodeSelection.filter((i) => i < p.nodes.length);
}

/** Write document-space nodes back to a path (refitting its box). */
export function setPathNodes(ed: EditorStore, id: Id, nodes: DocNode[], label: string, closed?: boolean): void {
  const loc = findObject(ed.getState().doc, id);
  if (!loc || loc.object.type !== 'path') return;
  const fit = docToPath(loc.object.box, nodes);
  const patch: Partial<PathObject> = { box: fit.box, nodes: fit.nodes };
  if (closed !== undefined) patch.closed = closed;
  ed.edit(label, (d) => updateObject(d, id, patch as Partial<SceneObject>));
}

export function nudgeNodes(ed: EditorStore, dx: number, dy: number): boolean {
  const p = editablePath(ed);
  const sel = p ? selectedNodes(ed, p) : [];
  if (!p || !sel.length) return false;
  setPathNodes(ed, p.id, moveAnchors(pathToDoc(p), sel, dx, dy), 'アンカーの移動');
  return true;
}

export function deleteSelectedNodes(ed: EditorStore): boolean {
  const p = editablePath(ed);
  const sel = p ? selectedNodes(ed, p) : [];
  if (!p || !sel.length) return false;
  const rest = deleteAnchors(pathToDoc(p), sel);
  if (!rest) {
    if (!window.confirm('アンカーが2つ未満になるため、パス全体を削除します。よろしいですか？')) return true;
    ed.edit('パスの削除', (d) => removeObjects(d, [p.id]));
    ed.select([]);
    return true;
  }
  // A closed path needs at least three anchors to enclose an area.
  setPathNodes(ed, p.id, rest, 'アンカーの削除', p.closed && rest.length >= 3);
  ed.set({ nodeSelection: [] });
  return true;
}

/** Make the selected anchors corners or smooth points. */
export function convertSelectedNodes(ed: EditorStore, to: 'corner' | 'smooth'): void {
  const p = editablePath(ed);
  const sel = p ? selectedNodes(ed, p) : [];
  if (!p || !sel.length) return;
  let nodes = pathToDoc(p);
  for (const i of sel) nodes = to === 'corner' ? makeCorner(nodes, i) : makeSmooth(nodes, i, p.closed);
  setPathNodes(ed, p.id, nodes, to === 'corner' ? '角のアンカーに変換' : '曲線のアンカーに変換');
}

/** Double-clicking an anchor toggles between corner and smooth. */
export function toggleNodeType(ed: EditorStore, i: number): void {
  const p = editablePath(ed);
  if (!p || i >= p.nodes.length) return;
  const nodes = pathToDoc(p);
  const n = nodes[i];
  const next = isSmooth(n) || n.in || n.out ? makeCorner(nodes, i) : makeSmooth(nodes, i, p.closed);
  setPathNodes(ed, p.id, next, 'アンカーの種類の変更');
  ed.set({ nodeSelection: [i] });
}

export function insertNode(ed: EditorStore, segment: number, t: number): void {
  const p = editablePath(ed);
  if (!p) return;
  const r = splitSegment(pathToDoc(p), segment, t);
  setPathNodes(ed, p.id, r.nodes, 'アンカーの追加');
  ed.set({ nodeSelection: [r.index] });
}

export function setPathClosed(ed: EditorStore, closed: boolean): void {
  const p = editablePath(ed);
  if (!p) return;
  if (closed && p.nodes.length < 3) {
    ed.notify('error', 'パスを閉じるにはアンカーが3つ以上必要です。');
    return;
  }
  ed.edit(closed ? 'パスを閉じる' : 'パスを開く', (d) =>
    updateObject(d, p.id, { closed, fill: closed ? (p.fill ?? '#4a90e2') : p.fill } as Partial<SceneObject>),
  );
}
