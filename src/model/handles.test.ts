import { describe, expect, it } from 'vitest';
import { boundsResize, dragRect, handlePoint, resizeBox, snap45 } from './handles';
import type { Box } from './types';

const box: Box = { x: 100, y: 100, width: 200, height: 100, rotation: 0 };
const opts = { keepAspect: false, fromCenter: false };

describe('resizeBox', () => {
  it('moves only the dragged edge', () => {
    expect(resizeBox(box, 'e', { x: 400, y: 0 }, opts)).toMatchObject({ x: 100, y: 100, width: 300, height: 100 });
    expect(resizeBox(box, 'nw', { x: 50, y: 80 }, opts)).toMatchObject({ x: 50, y: 80, width: 250, height: 120 });
  });

  it('keeps aspect ratio when requested', () => {
    const r = resizeBox(box, 'se', { x: 500, y: 150 }, { ...opts, keepAspect: true });
    expect(r.width / r.height).toBeCloseTo(2);
    expect(r.width).toBeCloseTo(400);
    expect(r.x).toBeCloseTo(100);
  });

  it('resizes from the center', () => {
    const r = resizeBox(box, 'e', { x: 350, y: 0 }, { ...opts, fromCenter: true });
    expect(r).toMatchObject({ x: 50, width: 300, y: 100, height: 100 });
  });

  it('keeps the opposite corner fixed for rotated boxes', () => {
    const rotated: Box = { ...box, rotation: 30 };
    const fixedBefore = handlePoint(rotated, 'nw');
    const a = (30 * Math.PI) / 180;
    const target = {
      x: fixedBefore.x + 260 * Math.cos(a) - 140 * Math.sin(a),
      y: fixedBefore.y + 260 * Math.sin(a) + 140 * Math.cos(a),
    };
    const r = resizeBox(rotated, 'se', target, opts);
    const fixedAfter = handlePoint(r, 'nw');
    expect(fixedAfter.x).toBeCloseTo(fixedBefore.x);
    expect(fixedAfter.y).toBeCloseTo(fixedBefore.y);
    expect(r.width).toBeCloseTo(260);
    expect(r.rotation).toBe(30);
  });

  it('never produces sizes below the minimum', () => {
    const r = resizeBox(box, 'e', { x: 0, y: 0 }, opts);
    expect(r.width).toBe(1);
  });
});

describe('helpers', () => {
  it('boundsResize scales around the opposite corner', () => {
    const t = boundsResize({ x: 0, y: 0, width: 100, height: 50 }, 'se', { x: 200, y: 100 }, opts);
    expect(t).toEqual({ pivot: { x: 0, y: 0 }, sx: 2, sy: 2 });
  });
  it('dragRect squares and centers', () => {
    expect(dragRect({ x: 10, y: 10 }, { x: 30, y: 15 }, true, false)).toEqual({ x: 10, y: 10, width: 20, height: 20 });
    expect(dragRect({ x: 10, y: 10 }, { x: 30, y: 15 }, false, true)).toEqual({ x: -10, y: 5, width: 40, height: 10 });
  });
  it('snap45 constrains direction', () => {
    const p = snap45({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.y).toBeCloseTo(0);
  });
});
