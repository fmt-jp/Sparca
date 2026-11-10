import { describe, expect, it } from 'vitest';
import { snapToGuides } from './smartGuides';

const canvas = { width: 800, height: 600 };
const free = { x: true, y: true };

describe('smart guides', () => {
  it('snaps a center to the canvas center (as before) with a full-height line', () => {
    const r = snapToGuides({ x: 347, y: 100, width: 100, height: 50 }, [], canvas, 6, free);
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(0);
    expect(r.lines).toEqual([{ axis: 'v', at: 400, from: 0, to: 600 }]);
  });

  it('snaps edges and centers to another object, lines spanning both', () => {
    const other = { x: 500, y: 300, width: 100, height: 100 };
    // Left edge 4 px right of the other's left edge; top 3 px below its middle (350).
    const r = snapToGuides({ x: 504, y: 353, width: 60, height: 40 }, [other], canvas, 6, free);
    expect(r.dx).toBe(-4);
    expect(r.dy).toBe(-3);
    // Lines span both: the moved one at (500, 350)–(560, 390), the other (500, 300)–(600, 400).
    expect(r.lines).toEqual([
      { axis: 'v', at: 500, from: 300, to: 400 },
      { axis: 'h', at: 350, from: 500, to: 600 },
    ]);
  });

  it('takes the closest alignment; nothing beyond the distance', () => {
    const others = [{ x: 200, y: 400, width: 50, height: 50 }, { x: 300, y: 400, width: 50, height: 50 }];
    // Right edge at 297: the second's left (300) is 3 away, the first's right (250) far.
    const r = snapToGuides({ x: 197, y: 100, width: 100, height: 40 }, others, canvas, 6, free);
    expect(r.dx).toBe(3);
    const far = snapToGuides({ x: 120, y: 120, width: 30, height: 30 }, others, canvas, 6, free);
    expect([far.dx, far.dy, far.lines]).toEqual([0, 0, []]);
  });

  it('a locked axis (Shift) does not move but still shows exact alignments', () => {
    const other = { x: 500, y: 100, width: 100, height: 100 };
    const r = snapToGuides({ x: 503, y: 300, width: 100, height: 40 }, [other], canvas, 6, { x: false, y: true });
    expect(r.dx).toBe(0);
    expect(r.lines.filter((l) => l.axis === 'v')).toEqual([]);
    const exact = snapToGuides({ x: 500, y: 300, width: 100, height: 40 }, [other], canvas, 6, { x: false, y: true });
    expect(exact.lines.filter((l) => l.axis === 'v').map((l) => l.at).sort((a, b) => a - b)).toEqual([500, 550, 600]);
  });
});
