// Effects list in the properties panel (Fireworks-style live filters): add from a menu,
// turn on/off, set strength, reorder (applied top to bottom), edit settings, remove.
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createEffect, EFFECT_GROUPS, effectLabel } from '../model/effects';
import { updateObject } from '../model/commands';
import type { Effect, EffectKind, Id, SceneObject } from '../model/types';
import { CurveEditor } from './CurveEditor';
import { Dialog } from './Dialog';
import { ColorPicker } from './ColorPicker';
import { ContextMenu } from './ContextMenu';
import { PopupSliderInput } from './controls';
import { editor } from './useEditor';

type NumParam = { key: string; label: string; min: number; max: number; sliderMin?: number; sliderMax?: number; suffix?: string; step?: number; precision?: number; percent?: boolean };
type Param =
  | ({ type: 'number' } & NumParam)
  | { type: 'color'; key: string; label: string }
  | { type: 'bool'; key: string; label: string };

const SHADOW: Param[] = [
  { type: 'color', key: 'color', label: '色' },
  { type: 'number', key: 'opacity', label: '不透明度', min: 0, max: 100, suffix: '%', percent: true },
  { type: 'number', key: 'angle', label: '角度', min: -180, max: 180, suffix: '°' },
  { type: 'number', key: 'distance', label: '距離', min: 0, max: 500, sliderMax: 100, suffix: 'px' },
  { type: 'number', key: 'blur', label: 'ぼかし', min: 0, max: 200, sliderMax: 50, suffix: 'px' },
];
const GLOW: Param[] = [
  { type: 'color', key: 'color', label: '色' },
  { type: 'number', key: 'opacity', label: '不透明度', min: 0, max: 100, suffix: '%', percent: true },
  { type: 'number', key: 'blur', label: 'ぼかし', min: 0, max: 200, sliderMax: 50, suffix: 'px' },
  { type: 'number', key: 'spread', label: '広がり', min: 0, max: 100, sliderMax: 30, suffix: 'px' },
];
const BEVEL: Param[] = [
  { type: 'number', key: 'width', label: '幅', min: 1, max: 100, sliderMax: 40, suffix: 'px' },
  { type: 'number', key: 'softness', label: '柔らかさ', min: 0, max: 50, sliderMax: 20, suffix: 'px' },
  { type: 'number', key: 'angle', label: '光の角度', min: -180, max: 180, suffix: '°' },
  { type: 'number', key: 'intensity', label: '明暗の強さ', min: 0, max: 100, suffix: '%', percent: true },
];

const PARAMS: Record<EffectKind, Param[]> = {
  'drop-shadow': SHADOW,
  'inner-shadow': SHADOW,
  glow: GLOW,
  'inner-glow': GLOW,
  'bevel-inner': BEVEL,
  'bevel-outer': [{ type: 'color', key: 'color', label: '縁の色' }, ...BEVEL],
  emboss: [...BEVEL, { type: 'bool', key: 'inset', label: 'くぼませる' }, { type: 'bool', key: 'showObject', label: 'オブジェクトの色を表示' }],
  blur: [{ type: 'number', key: 'radius', label: 'ぼかし量', min: 0, max: 200, sliderMax: 50, suffix: 'px' }],
  'zoom-blur': [
    { type: 'number', key: 'amount', label: '量', min: 0, max: 200, sliderMax: 100, suffix: '%', percent: true },
    { type: 'number', key: 'centerX', label: '中心 X', min: -100, max: 200, sliderMin: 0, sliderMax: 100, suffix: '%', percent: true },
    { type: 'number', key: 'centerY', label: '中心 Y', min: -100, max: 200, sliderMin: 0, sliderMax: 100, suffix: '%', percent: true },
  ],
  sharpen: [
    { type: 'number', key: 'amount', label: '量', min: 0, max: 500, suffix: '%', percent: true },
    { type: 'number', key: 'radius', label: '半径', min: 0.5, max: 20, sliderMax: 10, step: 0.5, precision: 1, suffix: 'px' },
  ],
  'brightness-contrast': [
    { type: 'number', key: 'brightness', label: '明るさ', min: -100, max: 100 },
    { type: 'number', key: 'contrast', label: 'コントラスト', min: -100, max: 100 },
  ],
  'hue-saturation': [
    { type: 'number', key: 'hue', label: '色相', min: -180, max: 180, suffix: '°' },
    { type: 'number', key: 'saturation', label: '彩度', min: -100, max: 100 },
    { type: 'number', key: 'lightness', label: '明度', min: -100, max: 100 },
  ],
  // Edited in its own dialog (CurvesDialog), confirmed with OK.
  curves: [],
  grayscale: [],
  sepia: [],
  invert: [],
  'color-overlay': [{ type: 'color', key: 'color', label: '色' }],
};

/** Display names; repeated kinds are numbered (ドロップシャドウ 2). */
export function effectNames(effects: Effect[]): string[] {
  const total = new Map<string, number>();
  for (const e of effects) total.set(e.kind, (total.get(e.kind) ?? 0) + 1);
  const seen = new Map<string, number>();
  return effects.map((e) => {
    const n = (seen.get(e.kind) ?? 0) + 1;
    seen.set(e.kind, n);
    return total.get(e.kind)! > 1 ? `${effectLabel(e.kind)} ${n}` : effectLabel(e.kind);
  });
}

function setEffects(id: Id, effects: Effect[], label: string, key?: string) {
  editor.edit(label, (d) => updateObject(d, id, { effects } as Partial<SceneObject>), key ? `${key}:${id}` : null);
}

export function EffectsPanel({ o }: { o: Exclude<SceneObject, { type: 'group' }> }) {
  const effects = o.effects;
  const names = effectNames(effects);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const addBtn = useRef<HTMLButtonElement>(null);

  const replace = (i: number, e: Effect, label: string, key?: string) =>
    setEffects(o.id, effects.map((x, k) => (k === i ? e : x)), label, key);
  const move = (i: number, d: -1 | 1) => {
    const next = [...effects];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setEffects(o.id, next, 'エフェクトの並べ替え');
  };
  const reorder = (from: number, to: number) => {
    const next = [...effects];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setEffects(o.id, next, 'エフェクトの並べ替え');
  };

  // Drag to reorder: grab a row by its grip or name. `to` is the insertion slot (0..n).
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  /** Set right after a drag so the name button's click doesn't also open/close the row. */
  const dragged = useRef(false);
  function startDrag(ev: React.PointerEvent, from: number) {
    if (ev.button !== 0 || !(ev.target as Element).closest('.effect-grip, .effect-name')) return;
    const sx = ev.clientX;
    const sy = ev.clientY;
    let active = false;
    let to = from;
    const move = (e: PointerEvent) => {
      if (!active && Math.hypot(e.clientX - sx, e.clientY - sy) < 4) return;
      active = true;
      // Near the panel's top/bottom edge, scroll it so longer lists can be reordered.
      const panel = list.current?.closest<HTMLElement>('.properties');
      if (panel) {
        const r = panel.getBoundingClientRect();
        if (e.clientY < r.top + 24) panel.scrollTop -= 12;
        else if (e.clientY > r.bottom - 24) panel.scrollTop += 12;
      }
      const rows = [...(list.current?.children ?? [])] as HTMLElement[];
      to = rows.filter((r) => {
        const b = r.getBoundingClientRect();
        return b.top + b.height / 2 < e.clientY;
      }).length;
      setDrag({ from, to });
    };
    const end = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (!active) return;
      setDrag(null);
      dragged.current = true;
      setTimeout(() => (dragged.current = false), 0);
      const dest = to > from ? to - 1 : to;
      if (commit && dest !== from) reorder(from, dest);
    };
    const onUp = () => end(true);
    const onCancel = () => end(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }
  /** Where the drop line shows: before row i, or after the last row. */
  const dropSlot = drag && drag.to !== drag.from && drag.to !== drag.from + 1 ? drag.to : null;

  // Tone curve dialog: everything from opening it to OK is one undo step; キャンセル
  // restores the curve (and, for a just-added curve, removes it again).
  const [curveDialog, setCurveDialog] = useState<{ id: string; isNew: boolean } | null>(null);
  const openCurves = (id: string, isNew = false) => {
    if (!isNew) editor.beginGesture();
    setCurveDialog({ id, isNew });
  };

  const add = (kind: EffectKind) => {
    const e = createEffect(kind);
    if (kind === 'curves') {
      // Like Fireworks: adding a tone curve opens its dialog right away.
      editor.beginGesture();
      setEffects(o.id, [...effects, e], `${effectLabel(kind)}の追加`);
      openCurves(e.id, true);
      return;
    }
    setEffects(o.id, [...effects, e], `${effectLabel(kind)}の追加`);
    setOpen((s) => new Set(s).add(e.id));
  };

  return (
    <div className="prop-section effects" role="group" aria-label="エフェクト">
      <div className="effects-head">
        <span className="section-title">エフェクト</span>
        <button
          ref={addBtn}
          type="button"
          aria-label="エフェクトを追加"
          aria-haspopup="menu"
          title="エフェクトを追加"
          onClick={() => {
            const r = addBtn.current!.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 2 });
          }}
        >
          ＋ 追加
        </button>
        {effects.length > 1 && <span className="hint">上から順に適用されます</span>}
        {!effects.length && <span className="hint">エフェクトはありません</span>}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="エフェクトの種類"
          onClose={() => setMenu(null)}
          items={EFFECT_GROUPS.map((g) => ({ label: g.label, children: g.kinds.map((k) => ({ label: k.label, action: () => add(k.kind) })) }))}
        />
      )}
      {effects.length > 0 && (
        <ol className={`effect-list${drag ? ' dragging' : ''}`} ref={list}>
          {effects.map((e, i) => {
            const name = names[i];
            const expanded = open.has(e.id);
            return (
              <li
                key={e.id}
                className={[
                  'effect-row',
                  e.enabled ? '' : 'off',
                  drag?.from === i ? 'drag-source' : '',
                  dropSlot === i ? 'drop-before' : '',
                  dropSlot === effects.length && i === effects.length - 1 ? 'drop-after' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-effect={e.kind}
              >
                <div className="effect-line" onPointerDown={(ev) => startDrag(ev, i)}>
                  <span className="effect-grip" title="ドラッグで並べ替え" aria-hidden="true" onPointerDown={(ev) => ev.preventDefault()}>
                    ⠿
                  </span>
                  <input
                    type="checkbox"
                    checked={e.enabled}
                    aria-label={`${name}を有効にする`}
                    title="一時的にオン／オフ"
                    onChange={(ev) => replace(i, { ...e, enabled: ev.target.checked }, `${name}を${ev.target.checked ? 'オン' : 'オフ'}`)}
                  />
                  <button
                    type="button"
                    className="effect-name"
                    aria-expanded={PARAMS[e.kind].length ? expanded : undefined}
                    aria-haspopup={e.kind === 'curves' ? 'dialog' : undefined}
                    aria-label={`${name}の設定`}
                    title={e.kind === 'curves' ? 'クリックでトーンカーブを編集' : undefined}
                    disabled={!PARAMS[e.kind].length && e.kind !== 'curves'}
                    onClick={() =>
                      !dragged.current &&
                      (e.kind === 'curves' ? openCurves(e.id) : setOpen((s) => {
                        const n = new Set(s);
                        if (n.has(e.id)) n.delete(e.id);
                        else n.add(e.id);
                        return n;
                      }))
                    }
                  >
                    <span aria-hidden="true" className="effect-caret">
                      {e.kind === 'curves' ? '⧉' : PARAMS[e.kind].length ? (expanded ? '▾' : '▸') : ''}
                    </span>
                    {name}
                  </button>
                  <span className="field-label">強さ</span>
                  <PopupSliderInput
                    label={`${name}の強さ`}
                    value={Math.round(e.strength * 100)}
                    min={0}
                    max={100}
                    suffix="%"
                    onChange={(v) => replace(i, { ...e, strength: v / 100 }, `${name}の強さの変更`, `fx-strength-${e.id}`)}
                  />
                  <button type="button" className="icon-btn" aria-label={`${name}を上へ`} title="上へ（先に適用）" disabled={i === 0} onClick={() => move(i, -1)}>
                    ▲
                  </button>
                  <button type="button" className="icon-btn" aria-label={`${name}を下へ`} title="下へ（後に適用）" disabled={i === effects.length - 1} onClick={() => move(i, 1)}>
                    ▼
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${name}を削除`}
                    title="削除"
                    onClick={() => setEffects(o.id, effects.filter((_, k) => k !== i), `${name}の削除`)}
                  >
                    ×
                  </button>
                </div>
                {expanded && (
                  <div className="effect-params">
                    {PARAMS[e.kind].map((p) => (
                      <ParamInput key={p.key} p={p} e={e} name={name} onChange={(next, key) => replace(i, next, `${name}の変更`, key)} />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {curveDialog &&
        (() => {
          const i = effects.findIndex((x) => x.id === curveDialog.id);
          const e = effects[i];
          if (!e || e.kind !== 'curves') return null;
          const close = (ok: boolean) => {
            if (ok) editor.endGesture(curveDialog.isNew ? 'トーンカーブの追加' : `${names[i]}の変更`);
            else editor.cancelGesture();
            setCurveDialog(null);
          };
          return createPortal(
            <Dialog
              title={`${names[i]}`}
              clearBackdrop
              onClose={() => close(false)}
              footer={
                <>
                  <button type="button" onClick={() => close(false)}>
                    キャンセル
                  </button>
                  <button type="button" className="primary" onClick={() => close(true)}>
                    OK
                  </button>
                </>
              }
            >
              <CurveEditor curves={e.curves} name={names[i]} size={256} gestures={false} onChange={(c) => replace(i, { ...e, curves: c }, `${names[i]}の変更`)} />
              <p className="hint">変更はキャンバスにすぐ反映されます（プレビュー）。OK で確定、キャンセルで元に戻ります。タイトルをドラッグすると画面を移動できます。</p>
            </Dialog>,
            document.body,
          );
        })()}
    </div>
  );
}

function ParamInput({ p, e, name, onChange }: { p: Param; e: Effect; name: string; onChange: (e: Effect, key?: string) => void }) {
  const v = (e as unknown as Record<string, unknown>)[p.key];
  const label = `${name}の${p.label}`;
  const set = (value: unknown, key?: string) => onChange({ ...e, [p.key]: value } as Effect, key);
  if (p.type === 'color') {
    return (
      <span className="field">
        <span className="field-label">{p.label}</span>
        <ColorPicker label={label} value={v as string} onChange={(c) => c && set(c)} />
      </span>
    );
  }
  if (p.type === 'bool') {
    return (
      <label className="toggle">
        <input type="checkbox" checked={v as boolean} onChange={(ev) => set(ev.target.checked)} />
        {p.label}
      </label>
    );
  }
  const scale = p.percent ? 100 : 1;
  return (
    <span className="field" role="group" aria-label={label}>
      <span className="field-label">{p.label}</span>
      <PopupSliderInput
        label={label}
        value={Math.round((v as number) * scale * 100) / 100}
        min={p.min}
        max={p.max}
        sliderMin={p.sliderMin}
        sliderMax={p.sliderMax}
        step={p.step}
        precision={p.precision}
        suffix={p.suffix}
        onChange={(n) => set(n / scale, `fx-${p.key}-${e.id}`)}
      />
    </span>
  );
}
