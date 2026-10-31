// Fill field: fill type (solid / linear / radial / conic / pattern) plus a color, gradient or
// pattern editor. Also used for strokes (without patterns).
import { useId, useRef, useState } from 'react';
import {
  GRADIENT_KINDS,
  colorAt,
  gradientAngle,
  isGradient,
  representativeColor,
  reversed,
  stopsCss,
  toGradient,
  withAngle,
} from '../model/gradient';
import { PATTERN_MOTIFS, PATTERN_SIZE, isPattern, motifInfo, toPattern, withMotif } from '../model/pattern';
import type { Fill, Gradient, GradientStop, Pattern } from '../model/types';
import { patternDef } from '../render/pattern';
import { ColorPicker } from './ColorPicker';
import { PopupSliderInput } from './controls';
import { editor } from './useEditor';

/** Called with the new fill, an undo label, and an optional merge key for repeated edits. */
type OnFill = (f: Fill | null, label: string, key?: string) => void;

export function FillInput({
  label,
  value,
  allowNone,
  allowPattern,
  size,
  onChange,
}: {
  label: string;
  value: Fill | null;
  allowNone?: boolean;
  /** Offer pattern fills (not for strokes). */
  allowPattern?: boolean;
  /** Object box size, for the gradient angle on screen. */
  size: { width: number; height: number };
  onChange: OnFill;
}) {
  const kind = isGradient(value) || isPattern(value) ? value.kind : 'solid';
  return (
    <span className="fill-input">
      <select
        aria-label={`${label}の種類`}
        value={kind}
        onChange={(e) => {
          const k = e.target.value;
          if (k === 'solid') onChange(representativeColor(value) ?? '#000000', `${label}を単色に変更`);
          else if (k === 'pattern') onChange(toPattern(value, representativeColor(value)), `${label}をパターンに変更`);
          else onChange(toGradient(k as Gradient['kind'], value), `${label}をグラデーションに変更`);
        }}
      >
        <option value="solid">単色</option>
        {GRADIENT_KINDS.map((g) => (
          <option key={g.kind} value={g.kind}>
            {g.label}グラデーション
          </option>
        ))}
        {(allowPattern || isPattern(value)) && <option value="pattern">パターン</option>}
      </select>
      {isGradient(value) ? (
        <GradientEditor g={value} label={label} size={size} onChange={(g, l, k) => onChange(g, l, k)} />
      ) : isPattern(value) ? (
        <PatternEditor p={value} label={label} onChange={(p, l, k) => onChange(p, l, k)} />
      ) : (
        <ColorPicker label={label} allowNone={allowNone} value={value} onChange={(c) => onChange(c, `${label}の変更`, 'fill')} />
      )}
    </span>
  );
}

const REMOVE_DISTANCE = 30;

function GradientEditor({
  g,
  label,
  size,
  onChange,
}: {
  g: Gradient;
  label: string;
  size: { width: number; height: number };
  onChange: (g: Gradient, label: string, key?: string) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [removing, setRemoving] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const sel = Math.min(selected, g.stops.length - 1);
  const stop = g.stops[sel];

  const setStops = (stops: GradientStop[], l: string, key?: string) => onChange({ ...g, stops }, l, key);
  const patchStop = (i: number, patch: Partial<GradientStop>, l: string, key?: string) =>
    setStops(g.stops.map((s, k) => (k === i ? { ...s, ...patch } : s)), l, key);
  const offsetAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * 1000) / 1000;
  };

  function removeStop(i: number) {
    if (g.stops.length <= 2) return;
    setStops(g.stops.filter((_, k) => k !== i), 'グラデーションの色の削除');
    setSelected(Math.max(0, i - 1));
  }

  const angle = gradientAngle(g, size.width, size.height);

  return (
    <span className="gradient-editor">
      <span className="gradient-ramp">
        <div
          ref={bar}
          className="gradient-bar"
          role="group"
          aria-label={`${label}のグラデーション`}
          title="クリックで色を追加"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const offset = offsetAt(e.clientX);
            setStops([...g.stops, { offset, ...colorAt(g.stops, offset) }], 'グラデーションの色の追加');
            setSelected(g.stops.length);
          }}
        >
          <div className="gradient-bar-fill" style={{ background: stopsCss(g.stops) }} />
        </div>
        <div className="gradient-stops">
          {g.stops.map((s, i) => (
            <button
              key={i}
              type="button"
              className={`gradient-stop${i === sel ? ' selected' : ''}${removing === i ? ' removing' : ''}`}
              style={{ left: `${s.offset * 100}%`, ['--stop-color' as string]: s.color }}
              aria-label={`${label}の色${i + 1}（${Math.round(s.offset * 100)}%）`}
              aria-pressed={i === sel}
              title="ドラッグで位置を変更、下へドラッグで削除"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setSelected(i);
                editor.beginGesture();
              }}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const r = bar.current!.getBoundingClientRect();
                const away = g.stops.length > 2 && e.clientY - r.bottom > REMOVE_DISTANCE;
                setRemoving(away ? i : null);
                const offset = offsetAt(e.clientX);
                if (offset !== s.offset) patchStop(i, { offset }, 'グラデーションの色の移動');
              }}
              onPointerUp={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                e.currentTarget.releasePointerCapture(e.pointerId);
                if (removing === i) {
                  // Removing ends the drag: the stop goes, along with the move it made.
                  editor.cancelGesture();
                  setRemoving(null);
                  removeStop(i);
                  return;
                }
                editor.endGesture('グラデーションの色の移動');
              }}
              onPointerCancel={() => {
                setRemoving(null);
                editor.cancelGesture();
              }}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.1 : 0.01;
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  const offset = Math.min(1, Math.max(0, Math.round((s.offset + (e.key === 'ArrowLeft' ? -step : step)) * 1000) / 1000));
                  patchStop(i, { offset }, 'グラデーションの色の移動', `stop-offset-${i}`);
                } else if (e.key === 'Delete' || e.key === 'Backspace') removeStop(i);
                else return;
                // Keep the editor's shortcuts (nudge, delete object) from seeing these keys.
                e.preventDefault();
                e.stopPropagation();
              }}
            />
          ))}
        </div>
      </span>
      {stop && (
        <>
          <ColorPicker
            label="グラデーションの色"
            value={stop.color}
            onChange={(c) => c && patchStop(sel, { color: c }, 'グラデーションの色の変更')}
          />
          <span className="field-label">不透明度</span>
          <PopupSliderInput
            label="色の不透明度"
            value={Math.round(stop.opacity * 100)}
            min={0}
            max={100}
            suffix="%"
            onChange={(v) => patchStop(sel, { opacity: v / 100 }, 'グラデーションの不透明度の変更', 'stop-opacity')}
          />
          <span className="field-label">位置</span>
          <PopupSliderInput
            label="色の位置"
            value={Math.round(stop.offset * 100)}
            min={0}
            max={100}
            suffix="%"
            onChange={(v) => patchStop(sel, { offset: v / 100 }, 'グラデーションの色の移動', 'stop-offset')}
          />
          <button type="button" disabled={g.stops.length <= 2} title="選択中の色を削除" onClick={() => removeStop(sel)}>
            色を削除
          </button>
        </>
      )}
      {g.kind !== 'radial' && (
        <>
        <span className="field-label">角度</span>
        <PopupSliderInput
          label="グラデーションの角度"
          value={Math.round(angle)}
          min={-180}
          max={180}
          suffix="°"
          onChange={(v) => onChange(withAngle(g, v, size.width, size.height), 'グラデーションの角度の変更', 'gradient-angle')}
        />
        </>
      )}
      <button type="button" title="色の並びを反転" onClick={() => onChange(reversed(g), 'グラデーションの反転')}>
        反転
      </button>
    </span>
  );
}

/** Thumbnail of a motif for the motif buttons. */
function MotifThumb({ motif, id }: { motif: Pattern['motif']; id: string }) {
  const p: Pattern = { kind: 'pattern', motif, color: '#333333', background: '#ffffff', size: 12, angle: 0, weight: motifInfo(motif).weight };
  return (
    <svg width={26} height={26} viewBox="0 0 26 26" aria-hidden="true">
      <defs>{patternDef(p, id, 26, 26)}</defs>
      <rect width={26} height={26} fill={`url(#${id})`} />
    </svg>
  );
}

function PatternEditor({ p, label, onChange }: { p: Pattern; label: string; onChange: (p: Pattern, label: string, key?: string) => void }) {
  const uid = useId().replace(/:/g, '');
  const set = (patch: Partial<Pattern>, l: string, key?: string) => onChange({ ...p, ...patch }, l, key);
  return (
    <span className="pattern-editor">
      <span className="pattern-motifs" role="radiogroup" aria-label={`${label}の柄`}>
        {PATTERN_MOTIFS.map((m) => (
          <button
            key={m.motif}
            type="button"
            role="radio"
            aria-checked={p.motif === m.motif}
            aria-label={m.label}
            title={m.label}
            className={`pattern-motif${p.motif === m.motif ? ' selected' : ''}`}
            onClick={() => p.motif !== m.motif && onChange(withMotif(p, m.motif), '柄の変更')}
          >
            <MotifThumb motif={m.motif} id={`${uid}-${m.motif}`} />
          </button>
        ))}
      </span>
      <span className="field-label">柄の色</span>
      <ColorPicker label="柄の色" value={p.color} onChange={(c) => c && set({ color: c }, '柄の色の変更', 'pattern-color')} />
      <span className="field-label">地の色</span>
      <ColorPicker label="地の色" allowNone value={p.background} onChange={(c) => set({ background: c }, '地の色の変更', 'pattern-bg')} />
      <span className="field-label">大きさ</span>
      <PopupSliderInput
        label="柄の大きさ"
        value={p.size}
        min={PATTERN_SIZE.min}
        max={PATTERN_SIZE.max}
        sliderMax={100}
        suffix="px"
        onChange={(size) => set({ size }, '柄の大きさの変更', 'pattern-size')}
      />
      <span className="field-label">角度</span>
      <PopupSliderInput label="柄の角度" value={Math.round(p.angle)} min={-180} max={180} suffix="°" onChange={(angle) => set({ angle }, '柄の角度の変更', 'pattern-angle')} />
      {motifInfo(p.motif).usesWeight && (
        <>
          <span className="field-label">太さ</span>
          <PopupSliderInput
            label="柄の太さ"
            value={Math.round(p.weight * 100)}
            min={2}
            max={98}
            suffix="%"
            onChange={(v) => set({ weight: v / 100 }, '柄の太さの変更', 'pattern-weight')}
          />
        </>
      )}
    </span>
  );
}
