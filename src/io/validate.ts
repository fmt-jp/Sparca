// Structural validation of document.json. Rejects anything that would leave the editor
// in an inconsistent state; fills in fields added after a file was written.
import { createEffect, EFFECT_KINDS, migrateLegacyEffects } from '../model/effects';
import { MAX_CURVE_POINTS } from '../model/curves';
import { defaultPipeline } from '../model/factory';
import { PATTERN_MOTIFS, PATTERN_SIZE } from '../model/pattern';
import type { EffectKind, PatternMotif } from '../model/types';
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
      if (o.subpaths !== undefined) {
        arr(o, 'subpaths', where).forEach((c, k) => {
          const w = `${where}.subpaths[${k}]`;
          if (!isObj(c)) throw new Invalid(`${w} が正しくありません`);
          arr(c, 'nodes', w).forEach((n, j) => {
            if (!isObj(n) || !isObj(n.anchor)) throw new Invalid(`${w}.nodes[${j}] が正しくありません`);
          });
          c.closed = bool(c, 'closed', false);
        });
      }
      checkPaint(o, where);
      break;
    case 'text':
      str(o, 'text', where);
      str(o, 'fontFamily', where);
      num(o, 'fontSize', where);
      checkFill(o.color, `${where}.color`, false);
      if (o.path !== undefined) checkTextPath(o.path, `${where}.path`);
      break;
    case 'image': {
      const assetId = str(o, 'assetId', where);
      if (!isObj(assets[assetId])) throw new Invalid(`${where} が参照する画像 ${assetId} がありません`);
      o.pipeline = mergeDefaults(defaultPipeline(), o.pipeline);
      checkLocalEdits((o.pipeline as Obj).localEdits, `${where}.pipeline.localEdits`);
      // Blur first, so the tone (applied before the blur in the old pipeline) ends up first.
      migrateImageBlur(o);
      migrateImageTone(o);
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
    if (out.kind === 'curves') out.curves = checkCurves(e.curves ?? d.curves, `${w}.curves`);
    out.strength = Math.min(1, Math.max(0, out.strength as number));
    // Ids only need to be unique within the object.
    if (ids.has(out.id as string)) out.id = d.id;
    ids.add(out.id as string);
    return out;
  });
}

function checkCurves(v: unknown, where: string): Obj {
  if (!isObj(v)) throw new Invalid(`${where} が正しくありません`);
  const out: Obj = {};
  for (const ch of ['rgb', 'r', 'g', 'b']) {
    const pts = v[ch] === undefined ? [{ x: 0, y: 0 }, { x: 255, y: 255 }] : arr(v, ch, where);
    if (pts.length < 2 || pts.length > MAX_CURVE_POINTS) throw new Invalid(`${where}.${ch} の点の数が正しくありません`);
    let prev = -1;
    out[ch] = pts.map((p, i) => {
      const w = `${where}.${ch}[${i}]`;
      if (!isObj(p)) throw new Invalid(`${w} が正しくありません`);
      const x = num(p, 'x', w);
      const y = num(p, 'y', w);
      if (x < 0 || x > 255 || y < 0 || y > 255 || x <= prev) throw new Invalid(`${w} が範囲外か順序が正しくありません`);
      prev = x;
      return { x, y };
    });
  }
  return out;
}

/**
 * Files saved 2026-10-22..23 could hold a grayscale / sepia tone in the image color
 * adjustment; it is now done with the effects of the same name (same math), so the tone
 * becomes the first effect, its amount the effect's strength.
 */
function migrateImageTone(o: Obj) {
  const adj = (o.pipeline as Obj).adjust as Obj;
  const tone = adj.tone;
  const amount = typeof adj.toneAmount === 'number' ? adj.toneAmount : 100;
  delete adj.tone;
  delete adj.toneAmount;
  if ((tone === 'grayscale' || tone === 'sepia') && amount > 0) {
    (o.effects as unknown[]).unshift({ ...createEffect(tone), strength: Math.min(1, amount / 100) });
  }
}

/**
 * Older files had a whole-image blur in the image pipeline; the ぼかし effect does it now
 * (for every kind of object), so it becomes that effect, ahead of the others.
 */
function migrateImageBlur(o: Obj) {
  const p = o.pipeline as Obj;
  const radius = typeof p.blur === 'number' ? p.blur : 0;
  delete p.blur;
  if (radius > 0) (o.effects as unknown[]).unshift({ ...createEffect('blur'), radius });
}

/** Masked image edits: blur (radius) or mosaic (block size), each with a mask shape. */
function checkLocalEdits(v: unknown, where: string) {
  if (!Array.isArray(v)) throw new Invalid(`${where} が配列ではありません`);
  v.forEach((e, i) => {
    const w = `${where}[${i}]`;
    if (!isObj(e) || !isObj(e.mask)) throw new Invalid(`${w} が正しくありません`);
    checkMaskEdge(e.mask, `${w}.mask`);
    if (e.kind === 'blur') num(e, 'radius', w);
    else if (e.kind === 'erase') {
      // Mask only.
    } else if (e.kind === 'mosaic') {
      if (num(e, 'size', w) < 1) throw new Invalid(`${w}.size が小さすぎます`);
    } else throw new Invalid(`${w} の種類が正しくありません`);
  });
}

/** Optional edge fields of a mask: grow / feather in px, antialias flag. */
function checkMaskEdge(m: Obj, where: string) {
  for (const k of ['grow', 'feather'] as const) {
    if (m[k] === undefined) continue;
    if (typeof m[k] !== 'number' || !Number.isFinite(m[k])) throw new Invalid(`${where}.${k} が正しくありません`);
  }
  if (typeof m.feather === 'number' && m.feather < 0) throw new Invalid(`${where}.feather が負の値です`);
  if (m.antialias !== undefined && typeof m.antialias !== 'boolean') throw new Invalid(`${where}.antialias が正しくありません`);
}

const TEXT_PATH_ORIENTATIONS = new Set(['rotate', 'vertical', 'skew-vertical', 'skew-horizontal']);

/** Text on a path: the path's nodes, layout settings and the original path's look. */
function checkTextPath(v: unknown, where: string) {
  if (!isObj(v)) throw new Invalid(`${where} が正しくありません`);
  const nodes = arr(v, 'nodes', where);
  if (nodes.length < 2) throw new Invalid(`${where}.nodes にはアンカーが2つ以上必要です`);
  nodes.forEach((n, j) => {
    if (!isObj(n) || !isObj(n.anchor)) throw new Invalid(`${where}.nodes[${j}] が正しくありません`);
  });
  v.closed = bool(v, 'closed', false);
  num(v, 'offset', where);
  num(v, 'shift', where);
  v.reverse = bool(v, 'reverse', false);
  if (!TEXT_PATH_ORIENTATIONS.has(v.orientation as string)) throw new Invalid(`${where}.orientation が正しくありません`);
  const src = v.source;
  if (!isObj(src)) throw new Invalid(`${where}.source が正しくありません`);
  str(src, 'name', `${where}.source`);
  checkPaint(src, `${where}.source`);
  num(src, 'opacity', `${where}.source`);
  src.effects = checkEffects(src.effects, `${where}.source.effects`);
}

const GRADIENT_KINDS = new Set(['linear', 'radial', 'conic']);
const PATTERN_MOTIF_IDS = new Set(PATTERN_MOTIFS.map((m) => m.motif));

function checkPattern(v: Obj, where: string) {
  if (!PATTERN_MOTIF_IDS.has(v.motif as PatternMotif)) throw new Invalid(`${where}.motif が正しくありません`);
  str(v, 'color', where);
  if (v.background !== null && typeof v.background !== 'string') throw new Invalid(`${where}.background が正しくありません`);
  const size = num(v, 'size', where);
  if (!(size >= PATTERN_SIZE.min && size <= PATTERN_SIZE.max)) throw new Invalid(`${where}.size が範囲外です`);
  num(v, 'angle', where);
  const weight = num(v, 'weight', where);
  if (!(weight >= 0 && weight <= 1)) throw new Invalid(`${where}.weight が範囲外です`);
}

/** A fill is a color string, a gradient, (where allowed) a pattern, or (where allowed) null. */
function checkFill(v: unknown, where: string, allowNull: boolean, allowPattern = true) {
  if (typeof v === 'string' || (allowNull && v === null)) return;
  if (allowPattern && isObj(v) && v.kind === 'pattern') return checkPattern(v, where);
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
  checkFill(o.stroke, `${where}.stroke`, true, false);
  num(o, 'strokeWidth', where);
  if (o.strokeStyle !== undefined && !['solid', 'dashed', 'dotted'].includes(o.strokeStyle as string)) {
    throw new Invalid(`${where}.strokeStyle が正しくありません`);
  }
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
