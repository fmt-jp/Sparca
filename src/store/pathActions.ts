// Anchor-level editing of the selected path (subselect tool).
import { removeObjects, updateObject } from '../model/commands';
import {
  deleteAnchors,
  docContoursToPath,
  pathContours,
  pathContoursToDoc,
  isSmooth,
  makeCorner,
  makeSmooth,
  moveAnchors,
  pathToDoc,
  splitSegment,
  type DocNode,
} from '../model/pathEdit';
import { findObject, isEffectivelyLocked } from '../model/tree';
import type { Id, PathObject, SceneObject, ShapeObject, SparcaDocument } from '../model/types';
import type { EditorStore } from './editor';
import { canConvertToPath, shapeToPath } from '../model/shapeToPath';

/** A straight line shape as an equivalent open path with two anchors (same id, box, paint and effects). */
export function lineToPath(o: ShapeObject): PathObject | null {
  return o.shape.kind === 'line' ? shapeToPath(o) : null;
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
function selectedPath(ed: EditorStore): PathObject | null {
  const { doc, selection } = ed.getState();
  if (selection.length !== 1) return null;
  const loc = findObject(doc, selection[0]);
  if (!loc || loc.object.type !== 'path' || isEffectivelyLocked(loc)) return null;
  return loc.object;
}

/** Index of the outline being edited, clamped to the path's outlines. */
export function activeContour(ed: EditorStore, p: Pick<PathObject, 'subpaths'>): number {
  return Math.min(Math.max(0, ed.getState().nodeContour), p.subpaths?.length ?? 0);
}

/**
 * The selected path as seen by anchor editing: for a compound path, only the outline being
 * edited (its `nodes` / `closed`; same id and box). Writes go through setPathNodes /
 * writePathContour, which put that outline back among the others.
 */
export function editablePath(ed: EditorStore): PathObject | null {
  const p = selectedPath(ed);
  if (!p || !p.subpaths?.length) return p;
  const c = pathContours(p)[activeContour(ed, p)];
  return { ...p, nodes: c.nodes, closed: c.closed, subpaths: undefined };
}

/** Number of outlines of the selected path (1 for a simple path, 0 when none is selected). */
export function contourCount(ed: EditorStore): number {
  const p = selectedPath(ed);
  return p ? 1 + (p.subpaths?.length ?? 0) : 0;
}

/** Selected anchor indices, clamped to the path's current node count (undo can remove nodes). */
export function selectedNodes(ed: EditorStore, p: PathObject): number[] {
  return ed.getState().nodeSelection.filter((i) => i < p.nodes.length);
}

/**
 * Replace outline `contour` of path `id` (in a draft document) with document-space nodes,
 * refitting the box around all outlines.
 */
export function writePathContour(d: SparcaDocument, id: Id, contour: number, nodes: DocNode[], closed?: boolean): void {
  const loc = findObject(d, id);
  if (!loc || loc.object.type !== 'path') return;
  const o = loc.object;
  const all = pathContoursToDoc(o);
  const k = Math.min(contour, all.length - 1);
  all[k] = { nodes, closed: closed ?? all[k].closed };
  updateObject(d, id, docContoursToPath(o.box, all) as Partial<SceneObject>);
}

/** Write document-space nodes back to the outline being edited (refitting the box). */
export function setPathNodes(ed: EditorStore, id: Id, nodes: DocNode[], label: string, closed?: boolean): void {
  const loc = findObject(ed.getState().doc, id);
  if (!loc || loc.object.type !== 'path') return;
  const contour = activeContour(ed, loc.object);
  ed.edit(label, (d) => writePathContour(d, id, contour, nodes, closed));
}

/** Remove the outline being edited from a compound path. */
function removeContour(ed: EditorStore, p: PathObject): void {
  const all = pathContoursToDoc(p);
  all.splice(activeContour(ed, p), 1);
  ed.edit('アウトラインの削除', (d) => updateObject(d, p.id, docContoursToPath(p.box, all) as Partial<SceneObject>));
  ed.set({ nodeSelection: [], nodeContour: 0 });
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
  if (!rest && contourCount(ed) > 1) {
    removeContour(ed, selectedPath(ed)!);
    return true;
  }
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
  const contour = activeContour(ed, p);
  ed.edit(closed ? 'パスを閉じる' : 'パスを開く', (d) => {
    writePathContour(d, p.id, contour, pathToDoc(p), closed);
    updateObject(d, p.id, { fill: closed ? (p.fill ?? '#4a90e2') : p.fill } as Partial<SceneObject>);
  });
}

/** Shapes (also inside selected groups) the selection would turn into paths with 「パスに変換」. */
function convertibleShapes(ed: EditorStore): ShapeObject[] {
  const { doc, selection } = ed.getState();
  const out: ShapeObject[] = [];
  const visit = (o: SceneObject) => {
    if (o.type === 'group') o.children.forEach(visit);
    else if (o.type === 'shape' && canConvertToPath(o.shape) && !o.locked) out.push(o);
  };
  for (const id of selection) {
    const loc = findObject(doc, id);
    if (loc && !isEffectivelyLocked(loc)) visit(loc.object);
  }
  return out;
}

export function canConvertSelectionToPaths(ed: EditorStore): boolean {
  return convertibleShapes(ed).length > 0;
}

/**
 * 「パスに変換」: turn the selected shapes (and shapes in selected groups) into paths that
 * look the same, keeping their ids so the selection stays. One undo step. Returns how many.
 */
export function convertSelectionToPaths(ed: EditorStore): number {
  const shapes = convertibleShapes(ed);
  if (!shapes.length) return 0;
  ed.edit('パスに変換', (d) => {
    for (const o of shapes) {
      const l = findObject(d, o.id);
      const path = shapeToPath(o);
      if (l && path) l.siblings[l.index] = path;
    }
  });
  return shapes.length;
}
