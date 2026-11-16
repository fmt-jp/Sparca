// ライブラリ (2026-11-16, decided with the user): named sets of effects, fill and stroke kept in
// the browser (not in project files) and applied to objects in one go. Applying copies the
// settings into the objects; editing the library item later leaves them as they are.
// Library files (.hnbfx, JSON) carry items between browsers.
import { effectLabel } from './effects';
import { newId } from './factory';
import type { Effect, Fill, SceneObject, Stroke, StrokeCap, StrokeJoin, StrokeStyle } from './types';

export interface LibraryStroke {
  paint: Stroke | null;
  width: number;
  style?: StrokeStyle;
  cap?: StrokeCap;
  join?: StrokeJoin;
}

/** A library item: whatever parts it was registered with (at least one). */
export interface LibraryItem {
  id: string;
  name: string;
  effects?: Effect[];
  /** Fill of shapes and paths, the color of text. */
  fill?: Fill | null;
  stroke?: LibraryStroke;
}

export type LibraryPart = 'effects' | 'fill' | 'stroke';
export const PART_LABELS: Record<LibraryPart, string> = { effects: 'エフェクト', fill: '塗り', stroke: '線' };

/** The library file (.hnbfx). */
export const LIBRARY_FORMAT = 'hanabi-library';
export interface LibraryFile {
  format: typeof LIBRARY_FORMAT;
  version: 1;
  items: LibraryItem[];
}
export const LIBRARY_EXTENSION = '.hnbfx';
export const MAX_NAME_LENGTH = 60;

const clone = <T>(v: T): T => structuredClone(v);

/** The parts an object can give: images only effects, text no stroke, groups nothing (their content does). */
export function partsOf(o: SceneObject): LibraryPart[] {
  switch (o.type) {
    case 'shape':
    case 'path':
      return ['effects', 'fill', 'stroke'];
    case 'text':
      return ['effects', 'fill'];
    case 'image':
      return ['effects'];
    default:
      return [];
  }
}

export function itemParts(item: LibraryItem): LibraryPart[] {
  const out: LibraryPart[] = [];
  if (item.effects) out.push('effects');
  if (item.fill !== undefined) out.push('fill');
  if (item.stroke) out.push('stroke');
  return out;
}

/** A new item with the chosen parts of an object's settings. */
export function itemFromObject(o: SceneObject, name: string, parts: LibraryPart[]): LibraryItem {
  const item: LibraryItem = { id: newId('lib'), name };
  const can = partsOf(o);
  if (parts.includes('effects') && o.type !== 'group') item.effects = clone(o.effects);
  if (parts.includes('fill') && can.includes('fill')) item.fill = clone(o.type === 'text' ? o.color : o.type === 'shape' || o.type === 'path' ? o.fill : null);
  if (parts.includes('stroke') && (o.type === 'shape' || o.type === 'path')) {
    item.stroke = {
      paint: clone(o.stroke),
      width: o.strokeWidth,
      ...(o.strokeStyle ? { style: o.strokeStyle } : {}),
      ...(o.strokeCap ? { cap: o.strokeCap } : {}),
      ...(o.strokeJoin ? { join: o.strokeJoin } : {}),
    };
  }
  return item;
}

/** Same item with its parts replaced by the object's current settings (上書き). */
export function overwriteItem(item: LibraryItem, o: SceneObject): LibraryItem {
  const parts = itemParts(item).filter((p) => partsOf(o).includes(p));
  return { ...itemFromObject(o, item.name, parts.length ? parts : ['effects']), id: item.id };
}

/**
 * Apply an item to an object (a draft): its effects replace the object's (or, with `append`,
 * go after them), its fill and stroke replace the object's where the object has them. A group
 * passes it on to the objects inside. Effects get fresh ids.
 */
export function applyItem(o: SceneObject, item: LibraryItem, append = false): void {
  if (o.type === 'group') {
    for (const c of o.children) if (!c.locked) applyItem(c, item, append);
    return;
  }
  if (item.effects) {
    const fx = item.effects.map((e) => ({ ...clone(e), id: newId('fx') }));
    o.effects = append ? [...o.effects, ...fx] : fx;
  }
  if (item.fill !== undefined) {
    if (o.type === 'shape' || o.type === 'path') o.fill = clone(item.fill);
    else if (o.type === 'text' && item.fill !== null) o.color = clone(item.fill);
  }
  if (item.stroke && (o.type === 'shape' || o.type === 'path')) {
    const s = item.stroke;
    o.stroke = clone(s.paint);
    o.strokeWidth = s.width;
    if (s.style) o.strokeStyle = s.style;
    else delete o.strokeStyle;
    if (s.cap) o.strokeCap = s.cap;
    else delete o.strokeCap;
    if (s.join) o.strokeJoin = s.join;
    else delete o.strokeJoin;
  }
}

/** `name`, or `name 2`, `name 3`… so it differs from `taken`. */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(name)) return name;
  const base = name.replace(/ \d+$/, '');
  for (let n = 2; ; n++) {
    const next = `${base} ${n}`;
    if (!set.has(next)) return next;
  }
}

const paintName = (f: Fill | Stroke | null): string =>
  f === null ? 'なし' : typeof f === 'string' ? f : f.kind === 'pattern' ? 'パターン' : 'グラデーション';

/** What an item holds, for its tooltip (e.g. 「ドロップシャドウ・内側ベベル／塗り #ffcc00」). */
export function describeItem(item: LibraryItem): string {
  const parts: string[] = [];
  if (item.effects) parts.push(item.effects.length ? item.effects.map((e) => effectLabel(e.kind)).join('・') : 'エフェクトなし');
  if (item.fill !== undefined) parts.push(`塗り ${paintName(item.fill)}`);
  if (item.stroke) parts.push(`線 ${paintName(item.stroke.paint)}${item.stroke.paint ? ` ${item.stroke.width}px` : ''}`);
  return parts.join('／');
}

export function libraryFile(items: LibraryItem[]): LibraryFile {
  return { format: LIBRARY_FORMAT, version: 1, items: clone(items) };
}
