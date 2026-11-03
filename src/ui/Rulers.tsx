// Rulers along the top and left of the workspace (表示 → ルーラー). They count document px
// from the canvas's top-left corner or (表示 → ルーラーの原点) its center, follow scrolling and zooming, shade the canvas's extent
// and mark the pointer position. Screen only: drawn on <canvas> outside the document.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Point } from '../model/types';

export const RULER_SIZE = 20;

/** Distances between labeled ticks, in document px. */
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];

/** Labeled-tick spacing for a zoom: the smallest step at least `minPx` screen px apart. */
export function rulerStep(zoom: number, minPx = 50): { step: number; minor: number } {
  const step = STEPS.find((s) => s * zoom >= minPx) ?? STEPS[STEPS.length - 1];
  const minor = [10, 5, 2].find((n) => (step / n) * zoom >= 5 && Number.isInteger((step / n) * 1000)) ?? 1;
  return { step, minor: step / minor };
}

interface Props {
  workspaceRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  /** Screen px between the stage's corner and the canvas's. */
  pad: number;
  zoom: number;
  docWidth: number;
  docHeight: number;
  /** Count from the canvas's center instead of its top-left corner (negative to the left / above). */
  centered: boolean;
  cursor: Point | null;
}

export function Rulers(props: Props) {
  // Redraw on scroll and on size changes of the workspace.
  const [, setTick] = useState(0);
  useEffect(() => {
    const el = props.workspaceRef.current;
    if (!el) return;
    let frame = 0;
    const bump = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    el.addEventListener('scroll', bump, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(bump) : null;
    ro?.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', bump);
      ro?.disconnect();
    };
  }, [props.workspaceRef]);
  return (
    <>
      <div className="ruler-corner" aria-hidden="true" />
      <Ruler {...props} axis="x" />
      <Ruler {...props} axis="y" />
    </>
  );
}

function Ruler({ axis, stageRef, pad, zoom, docWidth, docHeight, centered, cursor }: Props & { axis: 'x' | 'y' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const rect = canvas.getBoundingClientRect();
    const length = axis === 'x' ? rect.width : rect.height;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const css = getComputedStyle(canvas);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const bg = color('--panel', '#33363b');
    const band = color('--panel-2', '#3b3e44');
    const ink = color('--text-dim', '#9a9ea6');
    const accent = color('--accent', '#4c9bf5');
    const s = stage.getBoundingClientRect();
    const docLength = axis === 'x' ? docWidth : docHeight;
    // Ruler values are document coordinates less `zero` (half the canvas when centered).
    const zero = centered ? docLength / 2 : 0;
    // Screen position (along the ruler) of ruler value 0.
    const origin = (axis === 'x' ? s.left + pad - rect.left : s.top + pad - rect.top) + zero * zoom;
    const at = (v: number) => origin + v * zoom;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, rect.width, rect.height);
    // The canvas's extent.
    ctx.fillStyle = band;
    const a = Math.max(0, at(-zero));
    const b = Math.min(length, at(docLength - zero));
    if (b > a) {
      if (axis === 'x') ctx.fillRect(a, 0, b - a, RULER_SIZE);
      else ctx.fillRect(0, a, RULER_SIZE, b - a);
    }

    const { step, minor } = rulerStep(zoom);
    const first = Math.floor(-origin / zoom / minor) * minor;
    const last = (length - origin) / zoom;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.beginPath();
    for (let v = first; v <= last; v += minor) {
      const value = Math.round(v * 1000) / 1000;
      const major = Math.abs(value / step - Math.round(value / step)) < 1e-6;
      const half = !major && Math.abs((value * 2) / step - Math.round((value * 2) / step)) < 1e-6;
      const len = major ? RULER_SIZE : half ? RULER_SIZE * 0.45 : RULER_SIZE * 0.25;
      const p = Math.round(at(value)) + 0.5;
      if (axis === 'x') {
        ctx.moveTo(p, RULER_SIZE);
        ctx.lineTo(p, RULER_SIZE - len);
      } else {
        ctx.moveTo(RULER_SIZE, p);
        ctx.lineTo(RULER_SIZE - len, p);
      }
      if (major) {
        const label = String(Math.round(value));
        if (axis === 'x') ctx.fillText(label, p + 3, 2);
        else {
          ctx.save();
          ctx.translate(2, p - 3);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
      }
    }
    ctx.stroke();
    // Edge toward the workspace.
    ctx.beginPath();
    if (axis === 'x') {
      ctx.moveTo(0, RULER_SIZE - 0.5);
      ctx.lineTo(rect.width, RULER_SIZE - 0.5);
    } else {
      ctx.moveTo(RULER_SIZE - 0.5, 0);
      ctx.lineTo(RULER_SIZE - 0.5, rect.height);
    }
    ctx.stroke();
    // The pointer.
    if (cursor) {
      const p = Math.round(at((axis === 'x' ? cursor.x : cursor.y) - zero)) + 0.5;
      ctx.strokeStyle = accent;
      ctx.beginPath();
      if (axis === 'x') {
        ctx.moveTo(p, 0);
        ctx.lineTo(p, RULER_SIZE);
      } else {
        ctx.moveTo(0, p);
        ctx.lineTo(RULER_SIZE, p);
      }
      ctx.stroke();
    }
  });
  return (
    <canvas
      ref={ref}
      className={`ruler ruler-${axis}`}
      data-testid={`ruler-${axis}`}
      aria-label={axis === 'x' ? '横のルーラー' : '縦のルーラー'}
      role="img"
    />
  );
}
