// Tone curve editor: pick a channel, drag points on the graph (click to add, drag off the
// graph or press Delete to remove), or type input/output levels for the selected point.
import { useRef, useState } from 'react';
import { addCurvePoint, CURVE_CHANNELS, identityCurve, moveCurvePoint, sampleCurve } from '../model/curves';
import type { CurveChannel, CurvePoint, Curves } from '../model/types';
import { NumberInput } from './controls';
import { editor } from './useEditor';

const SIZE = 180;
/** Dragging a point this far (levels) outside the graph removes it on release. */
const REMOVE_OUTSIDE = 24;

const STROKE: Record<CurveChannel, string> = { rgb: '#e8e8e8', r: '#ff5a5a', g: '#4cd964', b: '#4a90ff' };

function pathOf(points: CurvePoint[]): string {
  const ys = sampleCurve(points);
  let d = '';
  for (let v = 0; v < 256; v++) d += `${v ? 'L' : 'M'}${v} ${255 - ys[v]}`;
  return d;
}

export function CurveEditor({ curves, name, onChange }: { curves: Curves; name: string; onChange: (c: Curves, key?: string) => void }) {
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const [selected, setSelected] = useState(0);
  const [removing, setRemoving] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const points = curves[channel];
  const sel = Math.min(selected, points.length - 1);
  const isEnd = (i: number) => i === 0 || i === points.length - 1;

  const setPoints = (pts: CurvePoint[], key?: string) => onChange({ ...curves, [channel]: pts }, key);

  const toLevels = (clientX: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * 255, y: (1 - (clientY - r.top) / r.height) * 255 };
  };

  function removePoint(i: number) {
    if (isEnd(i) || points.length <= 2) return;
    setPoints(points.filter((_, k) => k !== i));
    setSelected(Math.max(0, i - 1));
  }

  /** Drag point i (already in `pts`) until release; one undo step. */
  function drag(e: React.PointerEvent, pts: CurvePoint[], i: number) {
    e.preventDefault();
    svg.current!.focus();
    const el = svg.current!;
    el.setPointerCapture(e.pointerId);
    let cur = pts;
    let away = false;
    const move = (ev: PointerEvent) => {
      const p = toLevels(ev.clientX, ev.clientY);
      away = !(i === 0 || i === cur.length - 1) && (p.x < -REMOVE_OUTSIDE || p.x > 255 + REMOVE_OUTSIDE || p.y < -REMOVE_OUTSIDE || p.y > 255 + REMOVE_OUTSIDE);
      setRemoving(away ? i : null);
      cur = moveCurvePoint(cur, i, p.x, p.y);
      onChange({ ...curves, [channel]: cur });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setRemoving(null);
      if (away) {
        onChange({ ...curves, [channel]: cur.filter((_, k) => k !== i) });
        setSelected(Math.max(0, i - 1));
      }
      editor.endGesture('トーンカーブの変更');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function onGraphDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const hit = (e.target as Element).getAttribute('data-curve-point');
    editor.beginGesture();
    if (hit !== null) {
      const i = Number(hit);
      setSelected(i);
      drag(e, points, i);
      return;
    }
    // Empty spot: add a point there and keep dragging it.
    const p = toLevels(e.clientX, e.clientY);
    const added = addCurvePoint(points, { x: Math.round(Math.min(255, Math.max(0, p.x))), y: Math.round(Math.min(255, Math.max(0, p.y))) });
    if (!added) {
      editor.cancelGesture();
      return;
    }
    setPoints(added.points);
    setSelected(added.index);
    drag(e, added.points, added.index);
  }

  function onKey(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 10 : 1;
    const p = points[sel];
    let next: CurvePoint[] | null = null;
    if (e.key === 'ArrowUp') next = moveCurvePoint(points, sel, p.x, p.y + step);
    else if (e.key === 'ArrowDown') next = moveCurvePoint(points, sel, p.x, p.y - step);
    else if (e.key === 'ArrowLeft') next = moveCurvePoint(points, sel, p.x - step, p.y);
    else if (e.key === 'ArrowRight') next = moveCurvePoint(points, sel, p.x + step, p.y);
    else if (e.key === 'Delete' || e.key === 'Backspace') removePoint(sel);
    else if (e.key === 'Tab' || e.key === 'Escape') return;
    else if (e.key === 'PageDown' || e.key === 'PageUp') {
      setSelected((sel + (e.key === 'PageDown' ? 1 : points.length - 1)) % points.length);
    } else return;
    // Keep the editor's shortcuts (nudge, delete object) from seeing these keys.
    e.preventDefault();
    e.stopPropagation();
    if (next) setPoints(next, `curve-key-${channel}-${sel}`);
  }

  const point = points[sel];
  return (
    <div className="curve-editor">
      <div className="button-row" role="group" aria-label={`${name}のチャンネル`}>
        {CURVE_CHANNELS.map((c) => (
          <button
            key={c.channel}
            type="button"
            className={`style-btn${channel === c.channel ? ' on' : ''}`}
            aria-pressed={channel === c.channel}
            onClick={() => {
              setChannel(c.channel);
              setSelected(0);
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <svg
        ref={svg}
        className="curve-graph"
        width={SIZE}
        height={SIZE}
        viewBox="-6 -6 267 267"
        tabIndex={0}
        role="group"
        aria-label={`${name}のカーブ`}
        aria-description="クリックで点を追加、ドラッグで移動、グラフの外へドラッグか Delete で削除。矢印キーで選択中の点を移動、PageUp／PageDown で点を切り替え"
        onPointerDown={onGraphDown}
        onKeyDown={onKey}
      >
        <rect x={0} y={0} width={255} height={255} className="curve-bg" />
        {[64, 128, 192].map((v) => (
          <g key={v} className="curve-grid">
            <line x1={v} y1={0} x2={v} y2={255} />
            <line x1={0} y1={v} x2={255} y2={v} />
          </g>
        ))}
        <line x1={0} y1={255} x2={255} y2={0} className="curve-diagonal" />
        {CURVE_CHANNELS.filter((c) => c.channel !== channel).map((c) => (
          <path key={c.channel} d={pathOf(curves[c.channel])} className="curve-other" stroke={STROKE[c.channel]} />
        ))}
        <path d={pathOf(points)} className="curve-line" stroke={STROKE[channel]} data-testid="curve-path" />
        {points.map((p, i) => (
          <rect
            key={i}
            data-curve-point={i}
            x={p.x - 5}
            y={255 - p.y - 5}
            width={10}
            height={10}
            className={`curve-point${i === sel ? ' selected' : ''}${removing === i ? ' removing' : ''}`}
          />
        ))}
      </svg>
      <div className="curve-fields">
        <label className="field">
          <span className="field-label">入力</span>
          <NumberInput label={`${name}の入力`} value={point.x} min={0} max={255} onCommit={(x) => setPoints(moveCurvePoint(points, sel, x, point.y))} />
        </label>
        <label className="field">
          <span className="field-label">出力</span>
          <NumberInput label={`${name}の出力`} value={point.y} min={0} max={255} onCommit={(y) => setPoints(moveCurvePoint(points, sel, point.x, y))} />
        </label>
        <button type="button" disabled={isEnd(sel)} onClick={() => removePoint(sel)}>
          点を削除
        </button>
        <button type="button" onClick={() => setPoints(identityCurve())}>
          リセット
        </button>
      </div>
    </div>
  );
}
