import { describe, expect, it } from 'vitest';
import { createEffect } from './effects';
import { createDocument, createShape } from './factory';
import { appendEffect, applyPaint, effectsMixed, fillOf, isMixed, selectionLeaves, setAllEffects, type Leaf } from './multiEdit';
import type { GroupObject, PathObject, ShapeObject, TextObject } from './types';

const box = { x: 0, y: 0, width: 50, height: 50, rotation: 0 };
const rect = (fill = '#ff0000'): ShapeObject => ({ ...createShape({ kind: 'rect', cornerRadius: 0 }, box), fill });
const line = (): ShapeObject => createShape({ kind: 'line', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }, box);
const text = (): TextObject => ({ id: 't', name: 'テキスト', type: 'text', visible: true, locked: false, opacity: 1, box, effects: [], content: 'a', color: '#000000' }) as unknown as TextObject;

describe('several objects at once', () => {
  it('reaches into groups and leaves locked objects out', () => {
    const doc = createDocument();
    const a = rect();
    const inner = rect('#00ff00');
    const lockedInner = { ...rect(), locked: true };
    const g = { id: 'g', name: 'グループ', type: 'group', visible: true, locked: false, opacity: 1, children: [inner, lockedInner] } as unknown as GroupObject;
    const locked = { ...rect(), locked: true };
    doc.layers[0].children.push(a, g, locked);
    expect(selectionLeaves(doc, [a.id, 'g', locked.id]).map((o) => o.id)).toEqual([a.id, inner.id]);
  });

  it('tells which settings differ; fills are those of shapes / closed paths and text colors', () => {
    expect(isMixed(['#ff0000', '#ff0000'])).toBe(false);
    expect(isMixed(['#ff0000', '#00ff00'])).toBe(true);
    expect(isMixed([])).toBe(false);
    expect(fillOf(rect())).toBe('#ff0000');
    expect(fillOf(text())).toBe('#000000');
    expect(fillOf(line())).toBeUndefined();
    expect(fillOf({ type: 'path', closed: false, fill: '#123456' } as unknown as PathObject)).toBeUndefined();
    // Effects compare without their ids.
    const a = rect();
    const b = rect();
    a.effects = [createEffect('glow')];
    b.effects = [createEffect('glow')];
    expect(effectsMixed([a, b])).toBe(false);
    b.effects[0] = { ...b.effects[0], strength: 0.5 };
    expect(effectsMixed([a, b])).toBe(true);
  });

  it('applies a fill to shapes and as text color; stroke settings only to shapes and paths', () => {
    const r = rect();
    const t = text();
    const l = line();
    for (const o of [r, t, l] as Leaf[]) applyPaint(o, { fill: '#0000ff' });
    expect(r.fill).toBe('#0000ff');
    expect(t.color).toBe('#0000ff');
    expect(l.fill).not.toBe('#0000ff'); // a line has no fill
    // No fill: shapes lose theirs, text keeps its color.
    applyPaint(r, { fill: null });
    applyPaint(t, { fill: null });
    expect(r.fill).toBeNull();
    expect(t.color).toBe('#0000ff');
    applyPaint(t, { stroke: '#ff0000', strokeWidth: 3 });
    expect('stroke' in t).toBe(false);
  });

  it('a stroke color with a width keeps the widths of objects that already have a stroke', () => {
    const thin = { ...rect(), stroke: null, strokeWidth: 0 };
    const thick = { ...rect(), stroke: '#000000', strokeWidth: 8 };
    for (const o of [thin, thick]) applyPaint(o, { stroke: '#ff0000', strokeWidth: 2 }, true);
    expect([thin.stroke, thin.strokeWidth]).toEqual(['#ff0000', 2]);
    expect([thick.stroke, thick.strokeWidth]).toEqual(['#ff0000', 8]);
    // A width alone goes to all.
    for (const o of [thin, thick]) applyPaint(o, { strokeWidth: 5 });
    expect([thin.strokeWidth, thick.strokeWidth]).toEqual([5, 5]);
  });

  it('effects: each object gets its own copy; an added one goes after the current ones', () => {
    const a = rect();
    const b = rect();
    b.effects = [createEffect('glow')];
    const list = [createEffect('drop-shadow')];
    setAllEffects(a, list);
    list[0].strength = 0.1;
    expect(a.effects[0].strength).toBe(1);
    const e = createEffect('inner-glow');
    appendEffect(a, e);
    appendEffect(b, e);
    expect(a.effects.map((x) => x.kind)).toEqual(['drop-shadow', 'inner-glow']);
    expect(b.effects.map((x) => x.kind)).toEqual(['glow', 'inner-glow']);
  });
});
