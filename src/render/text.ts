import { boxCenter, rotatePoint } from '../model/geometry';
import { cssFontFamily } from './fonts';
import type { Box, TextObject } from '../model/types';

export function textLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Distance from the top of a line box to the first baseline. */
export function textBaselineOffset(fontSize: number, lineHeight: number): number {
  return (fontSize * lineHeight - fontSize) / 2 + fontSize * 0.8;
}

let ctx: CanvasRenderingContext2D | null | undefined;

function measureCtx(): CanvasRenderingContext2D | null {
  if (ctx === undefined) {
    ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  }
  return ctx;
}

/** Natural size of the text block in px. Falls back to an estimate outside the browser. */
export function measureText(o: Pick<TextObject, 'text' | 'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'letterSpacing' | 'lineHeight'>): {
  width: number;
  height: number;
} {
  const lines = textLines(o.text);
  const c = measureCtx();
  let width = 0;
  for (const line of lines) {
    const chars = [...line].length;
    let w: number;
    if (c) {
      c.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.fontSize}px ${cssFontFamily(o.fontFamily)}`;
      w = c.measureText(line).width;
    } else {
      w = chars * o.fontSize * 0.6;
    }
    width = Math.max(width, w + chars * o.letterSpacing);
  }
  return {
    width: Math.max(Math.ceil(width), Math.ceil(o.fontSize * 0.5)),
    height: Math.ceil(lines.length * o.fontSize * o.lineHeight),
  };
}

/**
 * Box for `next` refitted to its natural size, keeping the point its alignment hangs from
 * fixed: the left edge (left), the middle (center) or the right edge (right) of the top.
 * Works for rotated text too (the box rotates about its center). Text on a path keeps its box.
 */
export function fitTextBox(next: TextObject): Box {
  const b = next.box;
  // Text on a path keeps the path's box: the box is where the path is.
  if (next.path) return b;
  const m = measureText(next);
  const f = next.align === 'center' ? 0.5 : next.align === 'right' ? 1 : 0;
  // The fixed point in document space, before the resize.
  const fixed = rotatePoint({ x: b.x + b.width * f, y: b.y }, boxCenter(b), b.rotation);
  // Where that point sits relative to the new box's center, rotated.
  const off = rotatePoint({ x: m.width * f - m.width / 2, y: -m.height / 2 }, { x: 0, y: 0 }, b.rotation);
  const c = { x: fixed.x - off.x, y: fixed.y - off.y };
  return { ...b, x: c.x - m.width / 2, y: c.y - m.height / 2, width: m.width, height: m.height };
}
