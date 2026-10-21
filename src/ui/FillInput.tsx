// Fill field: fill type (solid / linear / radial / conic) plus a color or a gradient editor.
import { useRef, useState } from 'react';
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
import type { Fill, Gradient, GradientStop } from '../model/types';
import { ColorPicker } from './ColorPicker';
import { PopupSliderInput } from './controls';
import { editor } from './useEditor';

/** Called with the new fill, an undo label, and an optional merge key for repeated edits. */
type OnFill = (f: Fill | null, label: string, key?: string) => void;

export function FillInput({
  label,
  value,
  allowNone,
  size,
  onChange,
}: {
  label: string;
  value: Fill | null;
  allowNone?: boolean;
  /** Object box size, for the gradient angle on screen. */
  size: { width: number; height: number };
  onChange: OnFill;
}) {
  const kind = isGradient(value) ? value.kind : 'solid';
  return (
    <span className="fill-input">
      <select
        aria-label={`${label}の種類`}
        value={kind}
        onChange={(e) => {
          const k = e.target.value;
          if (k === 'solid') onChange(representativeColor(value) ?? '#000000', `${label}を単色に変更`);
          else onChange(toGradient(k as Gradient['kind'], value), `${label}をグラデーションに変更`);
        }}
      >
        <option value="solid">単色</option>
        {GRADIENT_KINDS.map((g) => (
          <option key={g.kind} value={g.kind}>
            {g.label}グラデーション
          </option>
        ))}
      </select>
      {isGradient(value) ? (
        <GradientEditor g={value} label={label} size={size} onChange={(g, l, k) => onChange(g, l, k)} />
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
