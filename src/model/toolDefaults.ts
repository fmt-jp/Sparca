// Settings for new objects, chosen in the properties panel while a drawing tool is active
// (nothing selected). Each kind of drawing tool has its own: lines, shapes, block arrows,
// pen paths and text. They are a per-browser preference, not part of the document.
import { PATTERN_MOTIFS, PATTERN_SIZE } from './pattern';
import type { Fill, Paint, Stroke, StrokeStyle, TextObject } from './types';
import type { ToolId } from '../store/editor';

export type TextStyle = Pick<TextObject, 'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'color' | 'letterSpacing' | 'lineHeight' | 'align'>;

export interface ToolDefaults {
  line: Paint;
  shape: Paint;
  arrow: Paint;
  /** Fill is used for closed paths only. */
  pen: Paint;
  text: TextStyle;
}

export type PaintCategory = Exclude<keyof ToolDefaults, 'text'>;
export type ToolCategory = keyof ToolDefaults;

export const DEFAULT_TOOL_DEFAULTS: ToolDefaults = {
  line: { fill: null, stroke: '#222222', strokeWidth: 3, strokeStyle: 'solid' },
  shape: { fill: '#4a90e2', stroke: null, strokeWidth: 0, strokeStyle: 'solid' },
  // Annotation-style arrow: yellow with a black outline.
  arrow: { fill: '#ffe100', stroke: '#000000', strokeWidth: 4, strokeStyle: 'solid' },
  pen: { fill: '#4a90e2', stroke: '#222222', strokeWidth: 2, strokeStyle: 'solid' },
  text: { fontFamily: 'sans-serif', fontSize: 32, bold: false, italic: false, color: '#222222', letterSpacing: 0, lineHeight: 1.2, align: 'left' },
};

const CATEGORY_OF: Partial<Record<ToolId, ToolCategory>> = {
  line: 'line',
  rect: 'shape',
  'rounded-rect': 'shape',
  ellipse: 'shape',
  polygon: 'shape',
  star: 'shape',
  arrow: 'arrow',
  pen: 'pen',
  text: 'text',
};

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  line: 'ライン',
  shape: '図形',
  arrow: '矢印',
  pen: 'パス（ペン）',
  text: 'テキスト',
};

/** Which defaults a tool uses, or null for tools that create nothing. */
export function toolCategory(tool: ToolId): ToolCategory | null {
  return CATEGORY_OF[tool] ?? null;
}

// ---- Reading saved settings (anything unexpected falls back to the defaults) ----

const COLOR = /^#[0-9a-f]{6}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function sanitizeFill(v: unknown, allowNull: boolean, allowPattern = true): Fill | null | undefined {
  if (v === null) return allowNull ? null : undefined;
  if (typeof v === 'string') return COLOR.test(v) ? v : undefined;
  if (isObj(v) && ['linear', 'radial', 'conic'].includes(v.kind as string) && Array.isArray(v.stops) && v.stops.length >= 2 && isObj(v.start) && isObj(v.end)) {
    return v as unknown as Fill;
  }
  if (
    allowPattern &&
    isObj(v) &&
    v.kind === 'pattern' &&
    PATTERN_MOTIFS.some((m) => m.motif === v.motif) &&
    typeof v.color === 'string' &&
    COLOR.test(v.color) &&
    (v.background === null || (typeof v.background === 'string' && COLOR.test(v.background))) &&
    typeof v.size === 'number' &&
    v.size >= PATTERN_SIZE.min &&
    v.size <= PATTERN_SIZE.max &&
    typeof v.angle === 'number' &&
    Number.isFinite(v.angle) &&
    typeof v.weight === 'number' &&
    v.weight >= 0 &&
    v.weight <= 1
  ) {
    return v as unknown as Fill;
  }
  return undefined;
}

function sanitizePaint(v: unknown, base: Paint): Paint {
  if (!isObj(v)) return base;
  const out: Paint = { ...base };
  const fill = sanitizeFill(v.fill, true);
  if (fill !== undefined) out.fill = fill;
  const stroke = sanitizeFill(v.stroke, true, false);
  if (stroke !== undefined) out.stroke = stroke as Stroke | null;
  if (typeof v.strokeWidth === 'number' && v.strokeWidth >= 0 && v.strokeWidth <= 500) out.strokeWidth = v.strokeWidth;
  if (['solid', 'dashed', 'dotted'].includes(v.strokeStyle as string)) out.strokeStyle = v.strokeStyle as StrokeStyle;
  return out;
}

function sanitizeText(v: unknown, base: TextStyle): TextStyle {
  if (!isObj(v)) return base;
  const out: TextStyle = { ...base };
  if (typeof v.fontFamily === 'string' && v.fontFamily.trim()) out.fontFamily = v.fontFamily;
  if (typeof v.fontSize === 'number' && v.fontSize >= 1 && v.fontSize <= 2000) out.fontSize = v.fontSize;
  if (typeof v.bold === 'boolean') out.bold = v.bold;
  if (typeof v.italic === 'boolean') out.italic = v.italic;
  const color = sanitizeFill(v.color, false);
  if (color) out.color = color;
  if (typeof v.letterSpacing === 'number' && v.letterSpacing >= -100 && v.letterSpacing <= 1000) out.letterSpacing = v.letterSpacing;
  if (typeof v.lineHeight === 'number' && v.lineHeight >= 0.5 && v.lineHeight <= 5) out.lineHeight = v.lineHeight;
  if (v.align === 'left' || v.align === 'center' || v.align === 'right') out.align = v.align;
  return out;
}

export function sanitizeToolDefaults(v: unknown): ToolDefaults {
  const d = DEFAULT_TOOL_DEFAULTS;
  if (!isObj(v)) return d;
  return {
    line: { ...sanitizePaint(v.line, d.line), fill: null },
    shape: sanitizePaint(v.shape, d.shape),
    arrow: sanitizePaint(v.arrow, d.arrow),
    pen: sanitizePaint(v.pen, d.pen),
    text: sanitizeText(v.text, d.text),
  };
}
