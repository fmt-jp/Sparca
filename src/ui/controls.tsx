// Small form controls shared by the property panel and dialogs.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { editor } from './useEditor';

/**
 * Labelled form row. Use `group` for rows of buttons: a <label> would make the first
 * button take the whole row's text as its name and react to clicks on the label text.
 */
export function Field({ label, children, wide, group }: { label: string; children: ReactNode; wide?: boolean; group?: boolean }) {
  const cls = `field${wide ? ' wide' : ''}`;
  if (group) {
    return (
      <div className={cls} role="group" aria-label={label}>
        <span className="field-label">{label}</span>
        {children}
      </div>
    );
  }
  return (
    <label className={cls}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

/**
 * Numeric input that commits on Enter/blur, validates the range, and supports
 * ArrowUp/ArrowDown (Shift = ×10).
 */
export function NumberInput({
  value,
  onCommit,
  min = -Infinity,
  max = Infinity,
  step = 1,
  precision = 0,
  suffix,
  label,
  disabled,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  suffix?: string;
  label?: string;
  disabled?: boolean;
}) {
  const fmt = (v: number) => (Number.isFinite(v) ? String(Number(v.toFixed(precision))) : '');
  const [text, setText] = useState(fmt(value));
  const [invalid, setInvalid] = useState(false);
  /** Set when Enter already committed, so the blur that follows doesn't commit again. */
  const skipBlur = useRef(false);
  useEffect(() => {
    setText(fmt(value));
    setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, precision]);

  function commit(raw: string) {
    const v = Number(raw.replace(/,/g, '').trim());
    if (raw.trim() === '' || !Number.isFinite(v)) {
      setInvalid(true);
      editor.notify('error', `${label ?? '値'}には数値を入力してください。`);
      setText(fmt(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, v));
    if (clamped !== v) editor.notify('info', `${label ?? '値'}は ${min}〜${max} の範囲に調整しました。`);
    setInvalid(false);
    setText(fmt(clamped));
    if (clamped !== value) onCommit(clamped);
  }

  return (
    <span className={`number-input${invalid ? ' invalid' : ''}`}>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          if (skipBlur.current) skipBlur.current = false;
          else commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit((e.target as HTMLInputElement).value);
            skipBlur.current = true;
            // Hand keyboard focus back to the editor so shortcuts (Ctrl+Z etc.) work right away.
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') setText(fmt(value));
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const base = Number(text);
            commit(String((Number.isFinite(base) ? base : value) + d));
          }
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  );
}

/** Range slider + number box. Callers merge a drag into one undo step via an edit mergeKey. */
export function SliderInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  precision = 0,
  suffix,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  precision?: number;
  suffix?: string;
  label: string;
}) {
  return (
    <span className="slider-input">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <NumberInput value={value} onCommit={onChange} min={min} max={max} step={step} precision={precision} suffix={suffix} label={label} />
    </span>
  );
}

/** Color swatch with an optional "none" toggle. */
export function ColorInput({
  value,
  onChange,
  allowNone,
  label,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  allowNone?: boolean;
  label: string;
}) {
  const [last, setLast] = useState(value ?? '#000000');
  useEffect(() => {
    if (value) setLast(value);
  }, [value]);
  return (
    <span className="color-input">
      <input
        type="color"
        aria-label={label}
        value={toHex6(value ?? last)}
        disabled={value === null}
        onChange={(e) => onChange(e.target.value)}
      />
      {allowNone && (
        <label className="none-toggle" title={`${label}なし`}>
          <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : last)} />
          なし
        </label>
      )}
    </span>
  );
}

export function toHex6(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${[...c.slice(1)].map((x) => x + x).join('')}`.toLowerCase();
  return '#000000';
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

const SLIDER_HEIGHT = 120;

/**
 * Number box with a ▾ button that pops up a vertical slider (top = max), like Fireworks.
 * Dragging the slider is one undo step; typing in the box works as in NumberInput.
 */
export function PopupSliderInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  precision = 0,
  sliderMin,
  sliderMax,
  label,
  suffix,
  undoLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  /** Limits for typed values. */
  min: number;
  max: number;
  step?: number;
  precision?: number;
  /** Slider range when it should be narrower than what can be typed (defaults to min/max). */
  sliderMin?: number;
  sliderMax?: number;
  label: string;
  suffix?: string;
  undoLabel: string;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !panel.current?.contains(t)) setPos(null);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  function toggle() {
    if (open) {
      setPos(null);
      return;
    }
    const r = wrap.current!.getBoundingClientRect();
    const h = SLIDER_HEIGHT + 40;
    // Beside the ▾ so the number stays visible: extend downward when there is room,
    // otherwise upward from the box's bottom edge.
    const top = r.top + h <= window.innerHeight - 4 ? r.top : Math.max(4, r.bottom - h);
    setPos({ left: r.right + 4, top });
  }

  return (
    <span className="popup-slider" ref={wrap}>
      <NumberInput value={value} onCommit={onChange} min={min} max={max} step={step} precision={precision} suffix={suffix} label={label} />
      <button
        type="button"
        className={`popup-toggle${open ? ' open' : ''}`}
        aria-label={`${label}のスライダー`}
        aria-expanded={open}
        title="スライダーで調整"
        onClick={toggle}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {pos && (
        <div
          className="popup-panel"
          ref={panel}
          style={{ left: pos.left, top: pos.top }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setPos(null);
            }
          }}
        >
          <VerticalSlider
            value={value}
            min={sliderMin ?? min}
            max={Math.max(sliderMax ?? max, (sliderMin ?? min) + step)}
            step={step}
            label={label}
            onChange={onChange}
            undoLabel={undoLabel}
          />
        </div>
      )}
    </span>
  );
}

function VerticalSlider({
  value,
  min,
  max,
  step,
  label,
  onChange,
  undoLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  onChange: (v: number) => void;
  undoLabel: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  // Focus once when opened so the arrow keys work right away.
  useEffect(() => sliderRef.current?.focus(), []);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const frac = max > min ? (Math.min(max, Math.max(min, value)) - min) / (max - min) : 0;

  function fromPointer(clientY: number) {
    const r = track.current!.getBoundingClientRect();
    const f = 1 - Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    const v = clamp(min + f * (max - min));
    if (v !== value) onChange(v);
  }

  return (
    <div
      className="vslider"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      ref={sliderRef}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        editor.beginGesture();
        fromPointer(e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e.clientY);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        editor.endGesture(undoLabel);
      }}
      onPointerCancel={() => editor.endGesture(undoLabel)}
      onKeyDown={(e) => {
        const big = Math.max(step, (max - min) / 10);
        const delta: Record<string, number> = {
          ArrowUp: step,
          ArrowRight: step,
          ArrowDown: -step,
          ArrowLeft: -step,
          PageUp: big,
          PageDown: -big,
        };
        let next: number | null = null;
        if (e.key in delta) next = clamp(value + delta[e.key]);
        if (e.key === 'Home') next = min;
        if (e.key === 'End') next = max;
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation();
        if (next !== value) onChange(next);
      }}
    >
      <span className="vslider-max">{max}</span>
      <div className="vslider-track" ref={track} style={{ height: SLIDER_HEIGHT }}>
        <div className="vslider-fill" style={{ height: `${frac * 100}%` }} />
        <div className="vslider-thumb" style={{ bottom: `calc(${frac * 100}% - 6px)` }} />
      </div>
      <span className="vslider-min">{min}</span>
    </div>
  );
}
