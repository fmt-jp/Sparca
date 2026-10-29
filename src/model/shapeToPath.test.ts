import { describe, expect, it } from 'vitest';
import { createShape, defaultGeometry } from './factory';
import { canConvertToPath, shapeToPath, shapeToPathNodes } from './shapeToPath';
import type { PathNode, Point, ShapeGeometry } from './types';

/** Point at t on the segment from node a to node b (px), as pathNodesD draws it. */
function along(a: PathNode, b: PathNode, t: number, w: number, h: number): Point {
  const p0 = a.anchor;
  const p1 = a.out ?? a.anchor;
  const p2 = b.in ?? b.anchor;
  const p3 = b.anchor;
  const u = 1 - t;
  const c = (k: 'x' | 'y') => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k];
  return { x: c('x') * w, y: c('y') * h };
}

function outline(g: ShapeGeometry, w: number, h: number): Point[] {
  const r = shapeToPathNodes(g, w, h)!;
  const pts: Point[] = [];
  const n = r.nodes.length;
  for (let i = 0; i < (r.closed ? n : n - 1); i++) for (let k = 0; k < 16; k++) pts.push(along(r.nodes[i], r.nodes[(i + 1) % n], k / 16, w, h));
  return pts;
}

describe('shape to path', () => {
  it('an ellipse becomes four smooth anchors on the ellipse', () => {
    const r = shapeToPathNodes({ kind: 'ellipse' }, 200, 100)!;
    expect(r.closed).toBe(true);
    expect(r.nodes).toHaveLength(4);
    expect(r.nodes.every((n) => n.in && n.out)).toBe(true);
    for (const p of outline({ kind: 'ellipse' }, 200, 100)) {
      // (x−100)²/100² + (y−50)²/50² = 1 within 0.1 %
      expect(Math.abs(((p.x - 100) / 100) ** 2 + ((p.y - 50) / 50) ** 2 - 1)).toBeLessThan(0.002);
    }
  });

  it('a rectangle becomes four corners; rounded corners become quarter circles', () => {
    expect(shapeToPathNodes({ kind: 'rect', cornerRadius: 0 }, 100, 50)!.nodes.map((n) => n.anchor)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    const rounded = shapeToPathNodes({ kind: 'rect', cornerRadius: 10 }, 100, 50)!;
    expect(rounded.nodes).toHaveLength(8);
    // Points of the top-right arc lie 10 px from the corner circle's center (90, 10).
    const arc = [1, 4, 8, 12, 15].map((k) => along(rounded.nodes[0], rounded.nodes[1], k / 16, 100, 50));
    for (const p of arc) expect(Math.abs(Math.hypot(p.x - 90, p.y - 10) - 10)).toBeLessThan(0.01);
    // A pill (radius = half the height): the side edges vanish, so their anchors merge.
    const pill = shapeToPathNodes({ kind: 'rect', cornerRadius: 999 }, 100, 40)!;
    expect(pill.nodes).toHaveLength(6);
    // A circle-shaped rounded square: four smooth anchors.
    expect(shapeToPathNodes({ kind: 'rect', cornerRadius: 50 }, 100, 100)!.nodes).toHaveLength(4);
  });

  it('polygons, stars, block arrows and lines keep their corners', () => {
    expect(shapeToPathNodes({ kind: 'polygon', sides: 6 }, 100, 100)!.nodes).toHaveLength(6);
    expect(shapeToPathNodes({ kind: 'star', points: 5, innerRatio: 0.4 }, 100, 100)!.nodes).toHaveLength(10);
    expect(shapeToPathNodes(defaultGeometry('block-arrow'), 160, 90)!.nodes).toHaveLength(7);
    const line = shapeToPathNodes({ kind: 'line', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }, 10, 10)!;
    expect(line.closed).toBe(false);
    expect(line.nodes).toHaveLength(2);
    expect(canConvertToPath(defaultGeometry('arrow'))).toBe(false);
    expect(shapeToPathNodes(defaultGeometry('arrow'), 10, 10)).toBeNull();
  });

  it('keeps id, box, paint and effects', () => {
    const s = { ...createShape(defaultGeometry('star'), { x: 5, y: 6, width: 70, height: 80, rotation: 30 }), stroke: '#ff0000', strokeWidth: 3, strokeStyle: 'dashed' as const };
    const p = shapeToPath(s)!;
    expect(p).toMatchObject({ id: s.id, name: s.name, type: 'path', box: s.box, fill: s.fill, stroke: '#ff0000', strokeWidth: 3, strokeStyle: 'dashed', closed: true });
    expect('shape' in p).toBe(false);
  });
});
