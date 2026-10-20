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
