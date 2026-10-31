import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PATTERN_MOTIFS, toPattern, withMotif } from '../model/pattern';
import { createDocument, createShape, defaultGeometry } from '../model/factory';
import type { Pattern } from '../model/types';
import { DocumentSvg } from './DocumentSvg';
import { patternDef, patternTileSize } from './pattern';

const base: Pattern = { kind: 'pattern', motif: 'stripes', color: '#123456', background: '#ffffff', size: 20, angle: 30, weight: 0.5 };

describe('pattern fills', () => {
  it('every motif draws a tile centered on the box, turned by the angle', () => {
    for (const { motif } of PATTERN_MOTIFS) {
      const p = withMotif(base, motif);
      const svg = renderToStaticMarkup(patternDef(p, 'pt', 100, 60));
      const { width, height } = patternTileSize(p);
      expect(width).toBeGreaterThan(0);
      expect(svg).toContain('patternUnits="userSpaceOnUse"');
      expect(svg).toContain('patternTransform="translate(50 30) rotate(30)"');
      expect(svg).toContain(`x="${-width / 2}"`);
      expect(svg).toContain('#123456');
      expect(height).toBeGreaterThan(0);
    }
  });

  it('keeps its size in px whatever the box size', () => {
    expect(patternTileSize({ ...base, size: 40 })).toEqual({ width: 40, height: 40 });
    const a = renderToStaticMarkup(patternDef(base, 'pt', 100, 100));
    const b = renderToStaticMarkup(patternDef(base, 'pt', 300, 50));
    expect(a.match(/width="20"/)).toBeTruthy();
    expect(b.match(/width="20"/)).toBeTruthy();
  });

  it('a covering motif without a background is drawn through a mask', () => {
    const svg = renderToStaticMarkup(patternDef({ ...base, motif: 'seigaiha', background: null }, 'pt', 100, 100));
    expect(svg).toContain('<mask');
    expect(renderToStaticMarkup(patternDef({ ...base, motif: 'seigaiha' }, 'pt', 100, 100))).not.toContain('<mask');
  });

  it('starts from the current color and is rendered as the fill', () => {
    expect(toPattern('#ff0000', '#ff0000')).toMatchObject({ kind: 'pattern', color: '#ff0000', background: '#ffffff' });
    const doc = createDocument(200, 200);
    doc.layers[0].children = [{ ...createShape(defaultGeometry('rect'), { x: 10, y: 10, width: 50, height: 50, rotation: 0 }), id: 'r', fill: base }];
    const svg = renderToStaticMarkup(createElement(DocumentSvg, { doc, options: { imageHref: () => undefined } }));
    expect(svg).toContain('fill="url(#sp-fill-r)"');
    expect(svg).toContain('<pattern id="sp-fill-r"');
  });

  it('a gradient stroke gets its own paint server', () => {
    const doc = createDocument(200, 200);
    const stroke = { kind: 'linear' as const, start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, stops: [{ offset: 0, color: '#ff0000', opacity: 1 }, { offset: 1, color: '#0000ff', opacity: 1 }] };
    doc.layers[0].children = [{ ...createShape(defaultGeometry('rect'), { x: 10, y: 10, width: 50, height: 50, rotation: 0 }), id: 'r', stroke, strokeWidth: 4 }];
    const svg = renderToStaticMarkup(createElement(DocumentSvg, { doc, options: { imageHref: () => undefined } }));
    expect(svg).toContain('stroke="url(#sp-fill-r-stroke)"');
    expect(svg).toContain('<linearGradient id="sp-fill-r-stroke"');
  });
});

describe('line ends and corners', () => {
  it('render as stroke-linecap / stroke-linejoin; old documents keep round ends and corners', () => {
    const doc = createDocument(200, 200);
    const line = { ...createShape(defaultGeometry('line'), { x: 10, y: 10, width: 50, height: 50, rotation: 0 }), id: 'l' };
    doc.layers[0].children = [line];
    const draw = () => renderToStaticMarkup(createElement(DocumentSvg, { doc, options: { imageHref: () => undefined } }));
    expect(draw()).toContain('stroke-linecap="round"');
    expect(draw()).toContain('stroke-linejoin="round"');
    doc.layers[0].children = [{ ...line, strokeCap: 'butt', strokeJoin: 'miter' }];
    expect(draw()).toContain('stroke-linecap="butt"');
    expect(draw()).toContain('stroke-linejoin="miter"');
    expect(draw()).toContain('stroke-miterlimit="10"');
  });
});
