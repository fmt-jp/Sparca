// Color field: a swatch button that opens a Fireworks-style palette (spec: 色の選択).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BASIC_COLORS, hexToRgb, hsvToRgb, parseHex, rgbToHex, rgbToHsv, webSafeGrid, type Hsv } from './palette';

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
  /** "その他の色": the in-app color mixer, confirmed with OK. */
  const [mixing, setMixing] = useState(false);
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

  if (mixing) {
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
            setMixing(false);
          }
        }}
      >
        <ColorMixer initial={value ?? '#000000'} label={label} onOk={(c) => onChoose(c)} onCancel={() => setMixing(false)} />
      </div>
    );
  }

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
        <button type="button" className="palette-system" aria-label="その他の色" title="その他の色" onClick={() => setMixing(true)} />
      </div>
      <div className="palette-body">
        <div className="palette-basic">{BASIC_COLORS.map(cell)}</div>
        <div className="palette-grid">{GRID.flat().map(cell)}</div>
      </div>
    </div>
  );
}

/**
 * Color mixer for "その他の色": saturation/value square, hue bar, RGB and hex fields,
 * old/new preview. Nothing is applied until OK.
 */
function ColorMixer({
  initial,
  label,
  onOk,
  onCancel,
}: {
  initial: string;
  label: string;
  onOk: (c: string) => void;
  onCancel: () => void;
}) {
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(...hexToRgb(initial)));
  const rgb = hsvToRgb(hsv);
  const hex = rgbToHex(...rgb);
  const [hexText, setHexText] = useState(hex.toUpperCase());
  const sv = useRef<HTMLDivElement>(null);
  const hue = useRef<HTMLDivElement>(null);
  useEffect(() => setHexText(hex.toUpperCase()), [hex]);

  const setRgb = (r: number, g: number, b: number) => setHsv((prev) => {
    const n = rgbToHsv(r, g, b);
    // Keep the hue when the color is gray, so the square doesn't jump to red.
    return n.s === 0 || n.v === 0 ? { ...n, h: prev.h } : n;
  });

  function dragOn(el: HTMLDivElement | null, e: React.PointerEvent, fn: (fx: number, fy: number) => void) {
    if (!el) return;
    const apply = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      fn(Math.min(1, Math.max(0, (cx - r.left) / r.width)), Math.min(1, Math.max(0, (cy - r.top) / r.height)));
    };
    apply(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => apply(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const pure = rgbToHex(...hsvToRgb({ h: hsv.h, s: 1, v: 1 }));

  return (
    <div className="mixer" data-testid="color-mixer">
      <div className="mixer-title">その他の色</div>
      <div className="mixer-main">
        <div
          ref={sv}
          className="mixer-sv"
          role="slider"
          aria-label="彩度・明度"
          aria-valuetext={hex}
          style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pure})` }}
          onPointerDown={(e) => dragOn(sv.current, e, (fx, fy) => setHsv((p) => ({ ...p, s: fx, v: 1 - fy })))}
        >
          <span className="mixer-sv-mark" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
        </div>
        <div
          ref={hue}
          className="mixer-hue"
          role="slider"
          aria-label="色相"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsv.h)}
          onPointerDown={(e) => dragOn(hue.current, e, (_fx, fy) => setHsv((p) => ({ ...p, h: fy * 360 })))}
        >
          <span className="mixer-hue-mark" style={{ top: `${(hsv.h / 360) * 100}%` }} />
        </div>
        <div className="mixer-side">
          <div className="mixer-compare">
            <span style={{ background: hex }} title="新しい色" data-testid="mixer-new" />
            <span style={{ background: initial }} title="元の色" />
          </div>
          <div className="mixer-compare-labels">
            <span>新</span>
            <span>元</span>
          </div>
          {(['R', 'G', 'B'] as const).map((ch, i) => (
            <label key={ch} className="mixer-channel">
              {ch}
              <input
                type="number"
                min={0}
                max={255}
                aria-label={ch}
                value={rgb[i]}
                onChange={(e) => {
                  const n = Math.min(255, Math.max(0, Number(e.target.value) || 0));
                  const next = [...rgb] as [number, number, number];
                  next[i] = n;
                  setRgb(...next);
                }}
              />
            </label>
          ))}
          <input
            className="palette-hex"
            aria-label={`${label}の新しいカラーコード`}
            value={hexText}
            spellCheck={false}
            onChange={(e) => {
              setHexText(e.target.value);
              const c = parseHex(e.target.value);
              if (c) setRgb(...hexToRgb(c));
            }}
          />
        </div>
      </div>
      <div className="mixer-buttons">
        <button type="button" onClick={onCancel}>
          キャンセル
        </button>
        <button type="button" className="mixer-ok" onClick={() => onOk(hex)}>
          OK
        </button>
      </div>
    </div>
  );
}
