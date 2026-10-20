import type { TextObject } from '../model/types';

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
      c.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.fontSize}px ${o.fontFamily}`;
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
