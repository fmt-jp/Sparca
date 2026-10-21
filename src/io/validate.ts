// Structural validation of document.json. Rejects anything that would leave the editor
// in an inconsistent state; fills in fields added after a file was written.
import { createEffect, EFFECT_KINDS, migrateLegacyEffects } from '../model/effects';
import { defaultPipeline } from '../model/factory';
import type { EffectKind } from '../model/types';
import type { SparcaDocument } from '../model/types';
import { MAX_DIMENSION } from '../model/types';

type Result = { ok: true; doc: SparcaDocument } | { ok: false; error: string };

class Invalid extends Error {}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function num(o: Obj, k: string, where: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Invalid(`${where}.${k} が数値ではありません`);
  return v;
}
function str(o: Obj, k: string, where: string): string {
  const v = o[k];
  if (typeof v !== 'string') throw new Invalid(`${where}.${k} が文字列ではありません`);
  return v;
}
function bool(o: Obj, k: string, fallback: boolean): boolean {
  return typeof o[k] === 'boolean' ? (o[k] as boolean) : fallback;
}
function arr(o: Obj, k: string, where: string): unknown[] {
  const v = o[k];
  if (!Array.isArray(v)) throw new Invalid(`${where}.${k} が配列ではありません`);
  return v;
}

const OBJECT_TYPES = new Set(['shape', 'path', 'text', 'image', 'group']);
const SHAPE_KINDS = new Set(['rect', 'ellipse', 'polygon', 'star', 'line', 'arrow', 'block-arrow']);

export function validateDocument(raw: unknown): Result {
  try {
    if (!isObj(raw)) throw new Invalid('ルートがオブジェクトではありません');
    if (raw.version !== 1) throw new Invalid(`対応していないバージョンです（${String(raw.version)}）`);
    const width = num(raw, 'width', 'document');
    const height = num(raw, 'height', 'document');
    if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
      throw new Invalid(`キャンバス寸法が範囲外です（${width}×${height}）`);
    }
    const bg = raw.background;
    if (!isObj(bg) || (bg.kind !== 'transparent' && !(bg.kind === 'color' && typeof bg.color === 'string'))) {
      throw new Invalid('背景設定が正しくありません');
    }
    if (!isObj(raw.assets)) throw new Invalid('assets がありません');
    for (const [id, m] of Object.entries(raw.assets)) {
      if (!isObj(m)) throw new Invalid(`assets.${id} が正しくありません`);
      if (m.id !== id) throw new Invalid(`assets.${id} の id が一致しません`);
      str(m, 'mimeType', `assets.${id}`);
      num(m, 'width', `assets.${id}`);
      num(m, 'height', `assets.${id}`);
      if (typeof m.fileName !== 'string') m.fileName = '';
    }
    const layers = arr(raw, 'layers', 'document');
    if (layers.length === 0) throw new Invalid('レイヤーが1つもありません');
    const ids = new Set<string>();
    layers.forEach((l, i) => {
      const where = `layers[${i}]`;
      if (!isObj(l)) throw new Invalid(`${where} が正しくありません`);
      checkId(str(l, 'id', where), ids, where);
      str(l, 'name', where);
      l.visible = bool(l, 'visible', true);
      l.locked = bool(l, 'locked', false);
      arr(l, 'children', where).forEach((c, j) => checkObject(c, `${where}.children[${j}]`, ids, raw.assets as Obj));
    });
    const doc = raw as Obj;
    delete doc.format;
    return { ok: true, doc: doc as unknown as SparcaDocument };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

function checkId(id: string, ids: Set<string>, where: string) {
  if (!id) throw new Invalid(`${where}.id が空です`);
  if (ids.has(id)) throw new Invalid(`id が重複しています（${id}）`);
  ids.add(id);
}

function checkObject(o: unknown, where: string, ids: Set<string>, assets: Obj): void {
  if (!isObj(o)) throw new Invalid(`${where} が正しくありません`);
  const type = str(o, 'type', where);
  if (!OBJECT_TYPES.has(type)) throw new Invalid(`${where} の種類 "${type}" は不明です`);
  checkId(str(o, 'id', where), ids, where);
  if (typeof o.name !== 'string') o.name = '';
  o.visible = bool(o, 'visible', true);
  o.locked = bool(o, 'locked', false);
  o.opacity = typeof o.opacity === 'number' ? Math.min(1, Math.max(0, o.opacity)) : 1;
  if (type === 'group') {
    arr(o, 'children', where).forEach((c, j) => checkObject(c, `${where}.children[${j}]`, ids, assets));
    return;
  }
  const box = o.box;
  if (!isObj(box)) throw new Invalid(`${where}.box がありません`);
  for (const k of ['x', 'y', 'width', 'height', 'rotation']) num(box, k, `${where}.box`);
  o.effects = checkEffects(o.effects, `${where}.effects`);
  switch (type) {
    case 'shape': {
      const s = o.shape;
      if (!isObj(s) || !SHAPE_KINDS.has(s.kind as string)) throw new Invalid(`${where}.shape が正しくありません`);
      checkPaint(o, where);
      break;
    }
    case 'path':
      arr(o, 'nodes', where).forEach((n, j) => {
        if (!isObj(n) || !isObj(n.anchor)) throw new Invalid(`${where}.nodes[${j}] が正しくありません`);
      });
      o.closed = bool(o, 'closed', false);
      checkPaint(o, where);
      break;
    case 'text':
      str(o, 'text', where);
      str(o, 'fontFamily', where);
      num(o, 'fontSize', where);
      checkFill(o.color, `${where}.color`, false);
      break;
    case 'image': {
      const assetId = str(o, 'assetId', where);
      if (!isObj(assets[assetId])) throw new Invalid(`${where} が参照する画像 ${assetId} がありません`);
      o.pipeline = mergeDefaults(defaultPipeline(), o.pipeline);
      break;
    }
  }
}

/**
 * Effects list: unknown kinds are rejected, missing settings get their defaults, and the
 * older `{ glow, dropShadow }` form is converted.
 */
function checkEffects(v: unknown, where: string): unknown[] {
  if (v === undefined) return [];
  if (isObj(v)) return migrateLegacyEffects(v);
  if (!Array.isArray(v)) throw new Invalid(`${where} が正しくありません`);
  const ids = new Set<string>();
  return v.map((e, i) => {
    const w = `${where}[${i}]`;
    if (!isObj(e) || !EFFECT_KINDS.has(e.kind as string)) throw new Invalid(`${w} の種類が正しくありません`);
    const d = createEffect(e.kind as EffectKind) as unknown as Obj;
    const out: Obj = { ...d };
    for (const [k, dv] of Object.entries(d)) {
      if (k === 'kind' || !(k in e)) continue;
      if (typeof e[k] !== typeof dv || (typeof dv === 'number' && !Number.isFinite(e[k] as number))) {
        throw new Invalid(`${w}.${k} が正しくありません`);
      }
      out[k] = e[k];
    }
    out.strength = Math.min(1, Math.max(0, out.strength as number));
    // Ids only need to be unique within the object.
    if (ids.has(out.id as string)) out.id = d.id;
    ids.add(out.id as string);
    return out;
  });
}

const GRADIENT_KINDS = new Set(['linear', 'radial', 'conic']);

/** A fill is a color string, a gradient, or (where allowed) null. */
function checkFill(v: unknown, where: string, allowNull: boolean) {
  if (typeof v === 'string' || (allowNull && v === null)) return;
  if (!isObj(v) || !GRADIENT_KINDS.has(v.kind as string)) throw new Invalid(`${where} が正しくありません`);
  for (const k of ['start', 'end'] as const) {
    const p = v[k];
    if (!isObj(p)) throw new Invalid(`${where}.${k} が正しくありません`);
    num(p, 'x', `${where}.${k}`);
    num(p, 'y', `${where}.${k}`);
  }
  const stops = arr(v, 'stops', where);
  if (stops.length < 2) throw new Invalid(`${where}.stops には色が2つ以上必要です`);
  stops.forEach((st, i) => {
    const w = `${where}.stops[${i}]`;
    if (!isObj(st)) throw new Invalid(`${w} が正しくありません`);
    const off = num(st, 'offset', w);
    if (off < 0 || off > 1) throw new Invalid(`${w}.offset が範囲外です`);
    str(st, 'color', w);
    if (typeof st.opacity !== 'number') st.opacity = 1;
  });
}

function checkPaint(o: Obj, where: string) {
  checkFill(o.fill, `${where}.fill`, true);
  if (o.stroke !== null && typeof o.stroke !== 'string') throw new Invalid(`${where}.stroke が正しくありません`);
  num(o, 'strokeWidth', where);
}

/** Fill missing keys from defaults (one level of nesting for plain objects). */
function mergeDefaults<T extends object>(defaults: T, value: unknown): T {
  if (!isObj(value)) return defaults;
  const out: Obj = { ...(defaults as Obj) };
  for (const [k, v] of Object.entries(value)) {
    const d = (defaults as Obj)[k];
    out[k] = isObj(d) && isObj(v) ? { ...d, ...v } : v;
  }
  return out as T;
}
