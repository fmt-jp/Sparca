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
  it('every motif draws a tile centered on the box, turned by its angle', () => {
    for (const { motif } of PATTERN_MOTIFS) {
      const p = withMotif(base, motif);
      const svg = renderToStaticMarkup(patternDef(p, 'pt', 100, 60));
      const { width, height } = patternTileSize(p);
      expect(width).toBeGreaterThan(0);
      expect(svg).toContain('patternUnits="userSpaceOnUse"');
      const squash = p.slant !== undefined ? ` scale(1 ${Math.round(Math.tan((p.slant * Math.PI) / 180) * 1000) / 1000})` : '';
      expect(svg).toContain(`patternTransform="translate(50 30)${squash}${p.angle ? ` rotate(${p.angle})` : ''}"`);
      expect(svg).toContain(`x="${-width / 2}"`);
      expect(svg).toContain('#123456');
      expect(height).toBeGreaterThan(0);
    }
  });

  it('the motifs added 2026-11-15 start with their own size and angle (紗綾形 turned 45°)', () => {
    expect(withMotif(base, 'sayagata')).toMatchObject({ motif: 'sayagata', size: 140, angle: 45, slant: 27 });
    expect(withMotif(base, 'splatter')).toMatchObject({ size: 160 });
    expect(withMotif(base, 'kagome').angle).toBe(0); // back to its own angle (0°)
    expect(withMotif({ ...base, angle: 60 }, 'higaki').angle).toBe(45);
    expect(withMotif(base, 'higaki')).toMatchObject({ angle: 45, size: 60 });
    for (const motif of ['sayagata', 'kagome', 'hishi', 'tatewaku', 'raimon', 'kanoko', 'ajiro', 'splatter', 'higaki', 'chidori'] as const) {
      expect(PATTERN_MOTIFS.some((m) => m.motif === motif)).toBe(true);
    }
    // 籠目: a tile √3 times as tall as it is wide (three families of lines).
    const k = patternTileSize(withMotif(base, 'kagome'));
    expect(k.height / k.width).toBeCloseTo(Math.sqrt(3), 5);
  });

  it('つぶし squashes the turned motif so 45° lines lean at the given angle (紗綾形 starts at 27°)', () => {
    const p = withMotif(base, 'sayagata');
    expect(p.slant).toBe(27);
    expect(withMotif(p, 'stripes').slant).toBeUndefined(); // another motif drops it
    const tf = (q: Pattern) => /patternTransform="([^"]*)"/.exec(renderToStaticMarkup(patternDef(q, 'pt', 100, 100)))![1];
    expect(tf({ ...p, slant: 45 })).toBe('translate(50 50) rotate(45)');
    const m = /scale\(1 ([\d.]+)\)/.exec(tf(p));
    expect(Number(m![1])).toBeCloseTo(Math.tan((27 * Math.PI) / 180), 3);
    // A line along the tile's x axis, turned 45° and squashed, leans at 27°.
    const k = Number(m![1]);
    expect((Math.atan(k * Math.tan(Math.PI / 4)) * 180) / Math.PI).toBeCloseTo(27, 1);
  });

  it('油（しぶき） scatters the same way for the same seed, differently for another, and more with more thickness', () => {
    const p = withMotif(base, 'splatter');
    const svg = (q: Pattern) => renderToStaticMarkup(patternDef(q, 'pt', 100, 100));
    expect(svg({ ...p, seed: 5 })).toBe(svg({ ...p, seed: 5 }));
    expect(svg({ ...p, seed: 5 })).not.toBe(svg({ ...p, seed: 6 }));
    const count = (q: Pattern) => (svg(q).match(/<circle/g) ?? []).length;
    expect(count({ ...p, weight: 0.9 })).toBeGreaterThan(count({ ...p, weight: 0.1 }));
    // Each shape is drawn 9 times (the tile and its 8 neighbors), so nothing is cut at the seam.
    expect(count(p) % 9).toBe(0);
  });

  it('鹿の子 keeps its dots open without a background (through a mask)', () => {
    expect(renderToStaticMarkup(patternDef({ ...withMotif(base, 'kanoko'), background: null }, 'pt', 100, 100))).toContain('<mask');
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
