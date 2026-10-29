// Boolean operations on outlines (合体・型抜き・交差・中マド) with paper.js, which keeps
// curves as curves: results are cubic Bézier outlines that the subselect tool can edit.
// Loaded on demand (src/lazy.ts) because paper.js is large.
import paper from 'paper/dist/paper-core';
import type { DocContour, DocNode } from '../model/pathEdit';

export type BooleanOp = 'unite' | 'subtract' | 'intersect' | 'exclude';

let scope: paper.PaperScope | null = null;

/** A paper.js scope with a 1×1 off-screen view (only its geometry is used). */
function paperScope(): paper.PaperScope {
  if (!scope) {
    scope = new paper.PaperScope();
    scope.setup(new scope.Size(1, 1));
  }
  scope.activate();
  return scope;
}

function toPaperPath(s: paper.PaperScope, c: DocContour): paper.Path {
  const rel = (h: { x: number; y: number } | null, a: { x: number; y: number }) => (h ? new s.Point(h.x - a.x, h.y - a.y) : null);
  const path = new s.Path({ insert: false, closed: true });
  for (const n of c.nodes) {
    path.add(new s.Segment(new s.Point(n.anchor.x, n.anchor.y), rel(n.in, n.anchor) ?? undefined, rel(n.out, n.anchor) ?? undefined));
  }
  return path;
}

/** One object's outlines as a paper item (even-odd, like HANABI's compound paths). */
function toPaperItem(s: paper.PaperScope, contours: DocContour[]): paper.PathItem {
  if (contours.length === 1) return toPaperPath(s, contours[0]);
  const cp = new s.CompoundPath({ insert: false, children: contours.map((c) => toPaperPath(s, c)) });
  cp.fillRule = 'evenodd';
  return cp;
}

function fromPaperItem(item: paper.PathItem): DocContour[] {
  const paths: paper.Path[] = item instanceof paperScope().CompoundPath ? (item.children as paper.Path[]) : [item as paper.Path];
  const out: DocContour[] = [];
  for (const p of paths) {
    if (p.segments.length < 2 || Math.abs(p.area) < 1e-6) continue;
    const nodes: DocNode[] = p.segments.map((seg) => {
      const a = { x: seg.point.x, y: seg.point.y };
      const h = (v: paper.Point) => (v.isZero() ? null : { x: a.x + v.x, y: a.y + v.y });
      return { anchor: a, in: h(seg.handleIn), out: h(seg.handleOut) };
    });
    out.push({ nodes, closed: true });
  }
  return out;
}

/**
 * Combine objects, given bottom (back) first, each as its closed outlines in document
 * coordinates. 合体: union of all; 型抜き: the bottom one minus all the others; 交差: the part
 * every object covers; 中マド: the parts covered an odd number of times. Returns the result's
 * outlines (holes and separate parts included), or an empty list when nothing is left.
 */
export function booleanContours(objects: DocContour[][], op: BooleanOp): DocContour[] {
  const s = paperScope();
  const items = objects.map((o) => toPaperItem(s, o));
  const opts = { insert: false };
  let result: paper.PathItem;
  switch (op) {
    case 'unite':
      result = items.reduce((a, b) => a.unite(b, opts));
      break;
    case 'subtract':
      result = items.slice(1).reduce((a, b) => a.subtract(b, opts), items[0]);
      break;
    case 'intersect':
      result = items.reduce((a, b) => a.intersect(b, opts));
      break;
    case 'exclude':
      result = items.reduce((a, b) => a.exclude(b, opts));
      break;
  }
  return fromPaperItem(result);
}
