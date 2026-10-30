// Anchor-level editing of the selected path (subselect tool).
import { removeObjects, updateObject } from '../model/commands';
import {
  deleteAnchors,
  docContoursToPath,
  flattenContours,
  isSmooth,
  locateNode,
  makeCorner,
  makeSmooth,
  moveAnchors,
  pathContoursToDoc,
  splitSegment,
  unflattenContours,
  type DocContour,
  type DocNode,
  type FlatPath,
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
export function editablePath(ed: EditorStore): PathObject | null {
  const { doc, selection } = ed.getState();
  if (selection.length !== 1) return null;
  const loc = findObject(doc, selection[0]);
  if (!loc || loc.object.type !== 'path' || isEffectivelyLocked(loc)) return null;
  return loc.object;
}

/** All anchors of a path (every outline of a compound path) in document coordinates. */
export function flatPath(p: PathObject): FlatPath {
  return flattenContours(pathContoursToDoc(p));
}

/** Number of outlines of the selected path (1 for a simple path, 0 when none is selected). */
export function contourCount(ed: EditorStore): number {
  const p = editablePath(ed);
  return p ? 1 + (p.subpaths?.length ?? 0) : 0;
}

/** Selected anchor indices (global across outlines), clamped to the path's anchors (undo can remove some). */
export function selectedNodes(ed: EditorStore, p: PathObject): number[] {
  const total = p.nodes.length + (p.subpaths ?? []).reduce((n, c) => n + c.nodes.length, 0);
  return ed.getState().nodeSelection.filter((i) => i < total);
}

/** Write outlines (document space) back to path `id` in a draft document, refitting its box. */
function writeContours(d: SparcaDocument, id: Id, contours: DocContour[]): void {
  const loc = findObject(d, id);
  if (!loc || loc.object.type !== 'path') return;
  updateObject(d, id, docContoursToPath(loc.object.box, contours) as Partial<SceneObject>);
}

/**
 * Write moved anchors (the flat list of all outlines, same counts as now) back to path `id`
 * in a draft document.
 */
export function writePathNodes(d: SparcaDocument, id: Id, nodes: DocNode[]): void {
  const loc = findObject(d, id);
  if (!loc || loc.object.type !== 'path') return;
  writeContours(d, id, unflattenContours(flatPath(loc.object), nodes));
}

/** Write moved anchors (flat list of all outlines) back to a path as one edit. */
export function setPathNodes(ed: EditorStore, id: Id, nodes: DocNode[], label: string): void {
  ed.edit(label, (d) => writePathNodes(d, id, nodes));
}

export function nudgeNodes(ed: EditorStore, dx: number, dy: number): boolean {
  const p = editablePath(ed);
  const sel = p ? selectedNodes(ed, p) : [];
  if (!p || !sel.length) return false;
  setPathNodes(ed, p.id, moveAnchors(flatPath(p).nodes, sel, dx, dy), 'アンカーの移動');
  return true;
}

/**
 * Delete the selected anchors, on whichever outlines they are. An outline left with fewer
 * than two anchors goes away; a closed one left with two becomes open. When nothing is left
 * the whole path is deleted (after asking).
 */
export function deleteSelectedNodes(ed: EditorStore): boolean {
  const p = editablePath(ed);
  const sel = p ? selectedNodes(ed, p) : [];
  if (!p || !sel.length) return false;
  const flat = flatPath(p);
  const rest: DocContour[] = [];
  unflattenContours(flat, flat.nodes).forEach((c, k) => {
    const mine = sel.map((g) => locateNode(flat, g)).filter((x) => x.contour === k).map((x) => x.index);
    const nodes = deleteAnchors(c.nodes, mine);
    // A closed outline needs at least three anchors to enclose an area.
    if (nodes) rest.push({ nodes, closed: c.closed && nodes.length >= 3 });
  });
  if (!rest.length) {
    if (!window.confirm('アンカーが2つ未満になるため、パス全体を削除します。よろしいですか？')) return true;
    ed.edit('パスの削除', (d) => removeObjects(d, [p.id]));
    ed.select([]);
    return true;
  }
  ed.edit(rest.length < flat.contours.length ? 'アンカーとアウトラインの削除' : 'アンカーの削除', (d) => writeContours(d, p.id, rest));
  ed.set({ nodeSelection: [] });
  return true;
}

/** Apply `fn` to anchor g on its own outline (for edits that look at the neighbors). */
function onOwnOutline(flat: FlatPath, nodes: DocNode[], g: number, fn: (outline: DocNode[], i: number, closed: boolean) => DocNode[]): DocNode[] {
  const { contour, index } = locateNode(flat, g);
  const c = flat.contours[contour];
  const outline = fn(nodes.slice(c.start, c.start + c.length), index, c.closed);
  return [...nodes.slice(0, c.start), ...outline, ...nodes.slice(c.start + c.length)];
}

/** Make the selected anchors corners or smooth points. */
export function convertSelectedNodes(ed: EditorStore, to: 'corner' | 'smooth'): void {
  const p = editablePath(ed);
  const sel = p ? selectedNodes(ed, p) : [];
  if (!p || !sel.length) return;
  const flat = flatPath(p);
  let nodes = flat.nodes;
  for (const g of sel) nodes = onOwnOutline(flat, nodes, g, (o, i, closed) => (to === 'corner' ? makeCorner(o, i) : makeSmooth(o, i, closed)));
  setPathNodes(ed, p.id, nodes, to === 'corner' ? '角のアンカーに変換' : '曲線のアンカーに変換');
}

/** Double-clicking an anchor toggles between corner and smooth. */
export function toggleNodeType(ed: EditorStore, g: number): void {
  const p = editablePath(ed);
  if (!p) return;
  const flat = flatPath(p);
  if (g >= flat.nodes.length) return;
  const n = flat.nodes[g];
  const smooth = isSmooth(n) || n.in || n.out;
  setPathNodes(ed, p.id, onOwnOutline(flat, flat.nodes, g, (o, i, closed) => (smooth ? makeCorner(o, i) : makeSmooth(o, i, closed))), 'アンカーの種類の変更');
  ed.set({ nodeSelection: [g] });
}

/** Add an anchor on segment `segment` of outline `contour` at parameter t; it gets selected. */
export function insertNode(ed: EditorStore, contour: number, segment: number, t: number): void {
  const p = editablePath(ed);
  if (!p) return;
  const flat = flatPath(p);
  const outlines = unflattenContours(flat, flat.nodes);
  const k = Math.min(contour, outlines.length - 1);
  const r = splitSegment(outlines[k].nodes, segment, t);
  outlines[k] = { nodes: r.nodes, closed: outlines[k].closed };
  ed.edit('アンカーの追加', (d) => writeContours(d, p.id, outlines));
  ed.set({ nodeSelection: [flat.contours[k].start + r.index] });
}

/** The outline the selected anchors are on (the first one's), or the first outline. */
export function selectedOutline(ed: EditorStore, p: PathObject): number {
  const sel = selectedNodes(ed, p);
  return sel.length ? locateNode(flatPath(p), sel[0]).contour : 0;
}

/** Close or open the outline of the selected anchors (the only outline of a simple path). */
export function setPathClosed(ed: EditorStore, closed: boolean): void {
  const p = editablePath(ed);
  if (!p) return;
  const flat = flatPath(p);
  const outlines = unflattenContours(flat, flat.nodes);
  const k = selectedOutline(ed, p);
  if (closed && outlines[k].nodes.length < 3) {
    ed.notify('error', 'パスを閉じるにはアンカーが3つ以上必要です。');
    return;
  }
  outlines[k] = { ...outlines[k], closed };
  ed.edit(closed ? 'パスを閉じる' : 'パスを開く', (d) => {
    writeContours(d, p.id, outlines);
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
