import { describe, expect, it } from 'vitest';
import { strokeDash } from '../render/DocumentSvg';
import { DEFAULT_TOOL_DEFAULTS, sanitizeToolDefaults, toolCategory } from './toolDefaults';

describe('tool defaults', () => {
  it('maps tools to their settings', () => {
    expect(toolCategory('rect')).toBe('shape');
    expect(toolCategory('star')).toBe('shape');
    expect(toolCategory('line')).toBe('line');
    expect(toolCategory('arrow')).toBe('arrow');
    expect(toolCategory('pen')).toBe('pen');
    expect(toolCategory('text')).toBe('text');
    expect(toolCategory('select')).toBeNull();
  });

  it('reads saved settings, keeping valid values and dropping the rest', () => {
    const d = sanitizeToolDefaults({
      shape: { fill: '#112233', stroke: 'red', strokeWidth: 4, strokeStyle: 'dotted' },
      line: { fill: '#ffffff', strokeWidth: -3, strokeStyle: 'wavy' },
      text: { fontFamily: 'Meiryo', fontSize: 0, bold: true, align: 'middle' },
    });
    expect(d.shape).toEqual({ fill: '#112233', stroke: null, strokeWidth: 4, strokeStyle: 'dotted' });
    // Lines never get a fill.
    expect(d.line).toEqual({ ...DEFAULT_TOOL_DEFAULTS.line, fill: null });
    expect(d.text).toMatchObject({ fontFamily: 'Meiryo', fontSize: 32, bold: true, align: 'left' });
    expect(sanitizeToolDefaults('garbage')).toEqual(DEFAULT_TOOL_DEFAULTS);
  });

  it('keeps gradient strokes and pattern fills, but no pattern strokes', () => {
    const grad = { kind: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, stops: [{ offset: 0, color: '#000000', opacity: 1 }, { offset: 1, color: '#ffffff', opacity: 1 }] };
    const pattern = { kind: 'pattern', motif: 'seigaiha', color: '#112233', background: null, size: 30, angle: 0, weight: 0.3 };
    const d = sanitizeToolDefaults({ shape: { fill: pattern, stroke: grad, strokeWidth: 4 }, pen: { stroke: pattern }, text: { color: pattern } });
    expect(d.shape.fill).toEqual(pattern);
    expect(d.shape.stroke).toEqual(grad);
    expect(d.pen.stroke).toBe(DEFAULT_TOOL_DEFAULTS.pen.stroke);
    expect(d.text.color).toEqual(pattern);
    expect(sanitizeToolDefaults({ shape: { fill: { ...pattern, motif: 'x' } } }).shape.fill).toBe(DEFAULT_TOOL_DEFAULTS.shape.fill);
  });

  it('dash patterns scale with the stroke width', () => {
    expect(strokeDash(undefined, 3, 'butt')).toEqual({ strokeLinecap: 'butt' });
    expect(strokeDash('solid', 3, 'round')).toEqual({ strokeLinecap: 'round' });
    expect(strokeDash('dashed', 3, 'round')).toEqual({ strokeDasharray: '12 6', strokeLinecap: 'butt' });
    expect(strokeDash('dotted', 3, 'butt')).toEqual({ strokeDasharray: '0 6', strokeLinecap: 'round' });
  });
});
