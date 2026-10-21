// Color field: a swatch button that opens a Fireworks-style palette (spec: 色の選択).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BASIC_COLORS, parseHex, webSafeGrid } from './palette';

const GRID = webSafeGrid();
const PANEL_W = 300;
const PANEL_H = 250;

export function ColorPicker({
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
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !panel.current?.contains(t)) setPos(null);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [pos]);

  function toggle() {
    if (pos) {
      setPos(null);
      return;
    }
    const r = button.current!.getBoundingClientRect();
    const top = r.bottom + PANEL_H + 4 <= window.innerHeight ? r.bottom + 2 : Math.max(4, r.top - PANEL_H - 2);
    const left = Math.min(r.left, window.innerWidth - PANEL_W - 4);
    setPos({ left, top });
  }

  function choose(c: string | null) {
    onChange(c);
    setPos(null);
    button.current?.focus();
  }

  return (
    <span className="color-input">
      <button
        type="button"
        ref={button}
        className={`swatch-button${value === null ? ' none' : ''}`}
        style={value ? { background: value } : undefined}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={!!pos}
        data-color={value ?? 'none'}
        title={value ? `${label}: ${value}` : `${label}: なし`}
        onClick={toggle}
      />
      {pos &&
        createPortal(
          <Palette
            ref={panel}
            pos={pos}
            label={label}
            value={value}
            allowNone={!!allowNone}
            onChoose={choose}
            onClose={() => {
              setPos(null);
              button.current?.focus();
            }}
          />,
          document.body,
        )}
    </span>
  );
}

function Palette({
  ref,
  pos,
  label,
  value,
  allowNone,
  onChoose,
  onClose,
}: {
  ref: React.Ref<HTMLDivElement>;
  pos: { left: number; top: number };
  label: string;
  value: string | null;
  allowNone: boolean;
  onChoose: (c: string | null) => void;
  onClose: () => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [text, setText] = useState((value ?? '').toUpperCase());
  const [invalid, setInvalid] = useState(false);
  const system = useRef<HTMLInputElement>(null);
  const shown = hover ?? value;
  useEffect(() => {
    if (hover) setText(hover.toUpperCase());
  }, [hover]);

  function applyText() {
    const c = parseHex(text);
    if (!c) {
      setInvalid(true);
      return;
    }
    onChoose(c);
  }

  const cell = (c: string) => (
    <button
      key={c}
      type="button"
      className={`palette-cell${c === value ? ' current' : ''}`}
      style={{ background: c }}
      aria-label={c}
      title={c.toUpperCase()}
      onPointerEnter={() => setHover(c)}
      onPointerLeave={() => setHover(null)}
      onClick={() => onChoose(c)}
    />
  );

  return (
    <div
      className="palette"
      role="dialog"
      aria-label={`${label}のパレット`}
      ref={ref}
      style={{ left: pos.left, top: pos.top, width: PANEL_W }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="palette-top">
        <span className={`palette-preview${shown ? '' : ' none'}`} style={shown ? { background: shown } : undefined} />
        <input
          className={`palette-hex${invalid ? ' invalid' : ''}`}
          aria-label={`${label}のカラーコード`}
          value={text}
          autoFocus
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Consume it: focus returns to the swatch button, which would otherwise
              // receive this Enter as a click and reopen the palette.
              e.preventDefault();
              applyText();
            }
          }}
        />
        {allowNone && (
          <button type="button" className="palette-none" aria-label={`${label}なし`} title="なし（透明）" onClick={() => onChoose(null)} />
        )}
        <button
          type="button"
          className="palette-system"
          aria-label="その他の色（カラーピッカー）"
          title="その他の色"
          onClick={() => {
            const el = system.current!;
            try {
              el.showPicker();
            } catch {
              el.click();
            }
          }}
        />
        <input
          ref={system}
          type="color"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          defaultValue={value ?? '#000000'}
          onChange={(e) => onChoose(e.target.value)}
        />
      </div>
      <div className="palette-body">
        <div className="palette-basic">{BASIC_COLORS.map(cell)}</div>
        <div className="palette-grid">{GRID.flat().map(cell)}</div>
      </div>
    </div>
  );
}
