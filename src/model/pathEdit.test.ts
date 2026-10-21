import { describe, expect, it } from 'vitest';
import {
  bezierPoint, deleteAnchors, docToPath, isSmooth, makeCorner, makeSmooth, moveAnchors, moveHandle,
  nearestOnPath, pathToDoc, segmentPoints, splitSegment, type DocNode,
} from './pathEdit';
import type { Box } from './types';

const corner = (x: number, y: number): DocNode => ({ anchor: { x, y }, in: null, out: null });
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 4);
  expect(a.y).toBeCloseTo(b.y, 4);
};

describe('doc <-> path conversion', () => {
  it('round-trips and refits the box, also for rotated paths', () => {
    for (const rotation of [0, 30, -120]) {
      const box: Box = { x: 100, y: 50, width: 200, height: 100, rotation };
      const nodes = [
        { anchor: { x: 0, y: 1 }, in: null, out: { x: 0.3, y: 0 } },
        { anchor: { x: 1, y: 1 }, in: { x: 0.7, y: 0 }, out: null },
      ];
      const doc = pathToDoc({ box, nodes });
      const back = docToPath(box, doc);
      expect(back.box.rotation).toBe(rotation);
      // Same document-space geometry after the round trip.
      pathToDoc(back).forEach((n, i) => {
        close(n.anchor, doc[i].anchor);
        close(n.out ?? n.anchor, doc[i].out ?? doc[i].anchor);
      });
      // Moving an anchor outward grows the box but keeps the other points in place.
      const moved = moveAnchors(doc, [1], 50, 40);
      const refit = docToPath(box, moved);
      close(pathToDoc(refit)[0].anchor, doc[0].anchor);
      close(pathToDoc(refit)[1].anchor, moved[1].anchor);
    }
  });
});

describe('anchor and handle editing', () => {
  const smooth: DocNode = { anchor: { x: 0, y: 0 }, in: { x: -10, y: 0 }, out: { x: 20, y: 0 } };

  it('moves anchors together with their handles', () => {
    const [n] = moveAnchors([smooth], [0], 5, 5);
    expect(n).toEqual({ anchor: { x: 5, y: 5 }, in: { x: -5, y: 5 }, out: { x: 25, y: 5 } });
  });

  it('keeps smooth nodes smooth when a handle is dragged, unless independent', () => {
    expect(isSmooth(smooth)).toBe(true);
    const [n] = moveHandle([smooth], 0, 'out', { x: 0, y: 30 }, false);
    close(n.in!, { x: 0, y: -10 }); // opposite direction, original length 10
    expect(isSmooth(n)).toBe(true);
    const [c] = moveHandle([smooth], 0, 'out', { x: 0, y: 30 }, true);
    expect(c.in).toEqual({ x: -10, y: 0 });
    expect(isSmooth(c)).toBe(false);
  });

  it('converts between corner and smooth', () => {
    const nodes = [corner(0, 0), corner(30, 30), corner(60, 0)];
    const s = makeSmooth(nodes, 1, false);
    expect(isSmooth(s[1])).toBe(true);
    // Handle along prev→next (horizontal), a third of the distance to the next anchor.
    close(s[1].out!, { x: 30 + Math.hypot(30, 30) / 3, y: 30 });
    expect(makeCorner(s, 1)[1]).toEqual(corner(30, 30));
    // End points of an open path also get handles.
    expect(isSmooth(makeSmooth(nodes, 0, false)[0])).toBe(true);
  });

  it('deletes anchors but keeps at least two', () => {
    const nodes = [corner(0, 0), corner(1, 0), corner(2, 0)];
    expect(deleteAnchors(nodes, [1])).toHaveLength(2);
    expect(deleteAnchors(nodes, [0, 1])).toBeNull();
  });
});

describe('segments', () => {
  const curve: DocNode[] = [
    { anchor: { x: 0, y: 0 }, in: null, out: { x: 0, y: 100 } },
    { anchor: { x: 100, y: 0 }, in: { x: 100, y: 100 }, out: null },
  ];

  it('finds the nearest point on a curve', () => {
    const hit = nearestOnPath(curve, false, { x: 50, y: 80 })!;
    expect(hit.segment).toBe(0);
    expect(hit.t).toBeCloseTo(0.5, 2);
    expect(hit.dist).toBeCloseTo(5, 0); // curve peaks at y = 75
  });

  it('splits a curve without changing its shape', () => {
    const { nodes, index } = splitSegment(curve, 0, 0.5);
    expect(index).toBe(1);
    expect(nodes).toHaveLength(3);
    close(nodes[1].anchor, { x: 50, y: 75 });
    for (const t of [0.25, 0.5, 0.75]) {
      close(bezierPoint(segmentPoints(nodes, 0), t), bezierPoint(segmentPoints(curve, 0), t / 2));
      close(bezierPoint(segmentPoints(nodes, 1), t), bezierPoint(segmentPoints(curve, 0), 0.5 + t / 2));
    }
  });

  it('splits straight segments into corners, including the closing segment', () => {
    const tri = [corner(0, 0), corner(10, 0), corner(0, 10)];
    const r = splitSegment(tri, 2, 0.5); // segment from (0,10) back to (0,0)
    expect(r.nodes).toHaveLength(4);
    expect(r.nodes[3]).toEqual(corner(0, 5));
  });

  it('puts the new straight-segment point where nearestOnPath found it', () => {
    const line = [corner(0, 0), corner(200, 0)];
    const hit = nearestOnPath(line, false, { x: 50, y: 1 })!;
    const a = splitSegment(line, hit.segment, hit.t).nodes[1].anchor;
    expect(a.x).toBeCloseTo(50, 2);
    expect(a.y).toBe(0);
  });
});
