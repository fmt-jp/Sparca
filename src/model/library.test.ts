import { describe, expect, it } from 'vitest';
import { createEffect } from './effects';
import { createShape } from './factory';
import { applyItem, describeItem, itemFromObject, itemParts, libraryFile, overwriteItem, partsOf, uniqueName } from './library';
import type { GroupObject, ImageObject, SceneObject, ShapeObject, TextObject } from './types';
import { validateLibrary } from '../io/validate';

const box = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };

function gold(): ShapeObject {
  const s = createShape({ kind: 'rect', cornerRadius: 0 }, box);
  s.fill = { kind: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, stops: [{ offset: 0, color: '#f6d27a', opacity: 1 }, { offset: 1, color: '#b57d22', opacity: 1 }] };
  s.stroke = '#7a5512';
  s.strokeWidth = 3;
  s.strokeStyle = 'dashed';
  s.effects = [createEffect('bevel-inner'), createEffect('drop-shadow')];
  return s;
}

const text = (): TextObject =>
  ({
    id: 't1',
    name: 'テキスト',
    type: 'text',
    visible: true,
    locked: false,
    opacity: 1,
    box,
    effects: [],
    content: 'abc',
    color: '#000000',
  }) as unknown as TextObject;

describe('library items', () => {
  it('registers the chosen parts of a shape (a copy, not linked to the object)', () => {
    const s = gold();
    const item = itemFromObject(s, 'ゴールド', ['effects', 'fill', 'stroke']);
    expect(itemParts(item)).toEqual(['effects', 'fill', 'stroke']);
    expect(item.effects!.map((e) => e.kind)).toEqual(['bevel-inner', 'drop-shadow']);
    expect(item.stroke).toEqual({ paint: '#7a5512', width: 3, style: 'dashed' });
    // A copy: changing the object later leaves the item as it was.
    s.effects[0] = createEffect('glow');
    (s.fill as { stops: { color: string }[] }).stops[0].color = '#000000';
    expect(item.effects![0].kind).toBe('bevel-inner');
    expect(JSON.stringify(item.fill)).toContain('#f6d27a');
    // Only what was chosen.
    expect(itemParts(itemFromObject(s, 'x', ['effects']))).toEqual(['effects']);
  });

  it('what each kind of object can give: text no stroke, images only effects, groups nothing', () => {
    expect(partsOf(gold())).toEqual(['effects', 'fill', 'stroke']);
    expect(partsOf(text())).toEqual(['effects', 'fill']);
    expect(partsOf({ type: 'image' } as ImageObject)).toEqual(['effects']);
    expect(partsOf({ type: 'group' } as GroupObject)).toEqual([]);
    // Text's color is its fill.
    expect(itemFromObject({ ...text(), color: '#ff0000' }, 'x', ['fill']).fill).toBe('#ff0000');
  });

  it('applies: effects replace (or go after them), fill and stroke replace, with fresh effect ids', () => {
    const item = itemFromObject(gold(), 'ゴールド', ['effects', 'fill', 'stroke']);
    const target = createShape({ kind: 'ellipse' }, box);
    target.effects = [createEffect('glow')];
    applyItem(target, item);
    expect(target.effects.map((e) => e.kind)).toEqual(['bevel-inner', 'drop-shadow']);
    expect(target.effects[0].id).not.toBe(item.effects![0].id);
    expect(target.stroke).toBe('#7a5512');
    expect(target.strokeWidth).toBe(3);
    expect(target.strokeStyle).toBe('dashed');
    expect(JSON.stringify(target.fill)).toBe(JSON.stringify(item.fill));
    // Append: after the current ones.
    const t2 = createShape({ kind: 'ellipse' }, box);
    t2.effects = [createEffect('glow')];
    applyItem(t2, item, true);
    expect(t2.effects.map((e) => e.kind)).toEqual(['glow', 'bevel-inner', 'drop-shadow']);
    // An item without a stroke leaves the stroke alone; a solid stroke drops the old dash setting.
    const t3 = createShape({ kind: 'ellipse' }, box);
    t3.stroke = '#123456';
    applyItem(t3, itemFromObject(gold(), 'fx', ['effects']));
    expect(t3.stroke).toBe('#123456');
    const solid = { ...gold(), strokeStyle: undefined };
    const t4 = gold();
    applyItem(t4, itemFromObject(solid as ShapeObject, 's', ['stroke']));
    expect(t4.strokeStyle).toBeUndefined();
  });

  it('applies to text (fill → color, no stroke), images (effects) and the objects inside groups', () => {
    const item = itemFromObject(gold(), 'ゴールド', ['effects', 'fill', 'stroke']);
    const t = text();
    applyItem(t, item);
    expect(JSON.stringify(t.color)).toContain('#f6d27a');
    expect('stroke' in t).toBe(false);
    expect(t.effects).toHaveLength(2);
    const inner = createShape({ kind: 'rect', cornerRadius: 0 }, box);
    const locked = { ...createShape({ kind: 'rect', cornerRadius: 0 }, box), locked: true };
    const g = { type: 'group', children: [inner, locked] } as unknown as GroupObject;
    applyItem(g as SceneObject, item);
    expect(inner.effects).toHaveLength(2);
    expect(locked.effects).toHaveLength(0);
  });

  it('上書き keeps the item (id, name, parts) with the object’s current settings', () => {
    const item = itemFromObject(gold(), 'ゴールド', ['effects', 'stroke']);
    const other = createShape({ kind: 'rect', cornerRadius: 0 }, box);
    other.effects = [createEffect('glow')];
    other.stroke = '#ff0000';
    const next = overwriteItem(item, other);
    expect(next.id).toBe(item.id);
    expect(next.name).toBe('ゴールド');
    expect(itemParts(next)).toEqual(['effects', 'stroke']);
    expect(next.effects!.map((e) => e.kind)).toEqual(['glow']);
    expect(next.stroke!.paint).toBe('#ff0000');
  });

  it('names: unique with a number; the tooltip tells what is inside', () => {
    expect(uniqueName('影', [])).toBe('影');
    expect(uniqueName('影', ['影'])).toBe('影 2');
    expect(uniqueName('影 2', ['影', '影 2'])).toBe('影 3');
    expect(describeItem(itemFromObject(gold(), 'g', ['effects', 'fill', 'stroke']))).toBe('内側ベベル・ドロップシャドウ／塗り グラデーション／線 #7a5512 3px');
  });
});

describe('library files (.hnbfx)', () => {
  it('round-trips through JSON and validation', () => {
    const items = [itemFromObject(gold(), 'ゴールド', ['effects', 'fill', 'stroke']), itemFromObject(text(), '文字', ['fill'])];
    const r = validateLibrary(JSON.parse(JSON.stringify(libraryFile(items))));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items).toEqual(items);
  });

  it('fills in missing effect settings and rejects what is wrong, with the reason', () => {
    const ok = validateLibrary({ format: 'hanabi-library', version: 1, items: [{ id: 'a', name: '影', effects: [{ kind: 'drop-shadow' }] }] });
    expect(ok.ok && ok.items[0].effects![0]).toMatchObject({ kind: 'drop-shadow', distance: 6, enabled: true });
    const bad = (raw: unknown) => {
      const r = validateLibrary(raw);
      return r.ok ? '' : r.error;
    };
    expect(bad({ format: 'other' })).toContain('ライブラリファイルではありません');
    expect(bad({ format: 'hanabi-library', version: 2, items: [] })).toContain('バージョン');
    expect(bad({ format: 'hanabi-library', version: 1, items: [{ name: '' }] })).toContain('name');
    expect(bad({ format: 'hanabi-library', version: 1, items: [{ name: 'x' }] })).toContain('設定がありません');
    expect(bad({ format: 'hanabi-library', version: 1, items: [{ name: 'x', effects: [{ kind: 'nope' }] }] })).toContain('種類');
    expect(bad({ format: 'hanabi-library', version: 1, items: [{ name: 'x', fill: 'url(#evil)' }] })).toContain('fill');
    expect(bad({ format: 'hanabi-library', version: 1, items: [{ name: 'x', stroke: { paint: '#000000', width: -1 } }] })).toContain('width');
    expect(bad({ format: 'hanabi-library', version: 1, items: [{ name: 'x', stroke: { paint: '#000000', width: 1, cap: 'odd' } }] })).toContain('strokeCap');
  });
});
