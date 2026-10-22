import JSZip from 'jszip';
import { produce } from 'immer';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectError, readProject } from '../io/project';
import { effectsFilter } from '../render/effects';
import { addObject } from './commands';
import { defaultCurves } from './curves';
import { createEffect, EFFECT_GROUPS, migrateLegacyEffects } from './effects';
import { createDocument, createShape, defaultGeometry } from './factory';
import type { Effect } from './types';

const ALL = EFFECT_GROUPS.flatMap((g) => g.kinds.map((k) => k.kind));

function markup(effects: Effect[]): string {
  const f = effectsFilter('fx', effects, 100, 50, 0, 0);
  return f ? renderToStaticMarkup(createElement('svg', null, f)) : '';
}

async function load(rawEffects: unknown) {
  const doc = produce(createDocument(10, 10), (d) => {
    addObject(d, d.layers[0].id, createShape(defaultGeometry('rect'), { x: 0, y: 0, width: 5, height: 5, rotation: 0 }));
  });
  const raw = JSON.parse(JSON.stringify(doc));
  raw.layers[0].children[0].effects = rawEffects;
  const zip = new JSZip();
  zip.file('document.json', JSON.stringify(raw));
  return readProject(await zip.generateAsync({ type: 'uint8array' }));
}

describe('effects', () => {
  it('has defaults for every kind, and each renders a filter', () => {
    expect(ALL).toHaveLength(15);
    for (const kind of ALL) {
      const e = createEffect(kind);
      expect(e).toMatchObject({ kind, enabled: true, strength: 1 });
      // At defaults a few are no-ops (0 adjustments); give them something to do.
      const tweak =
        kind === 'brightness-contrast'
          ? { brightness: 20 }
          : kind === 'hue-saturation'
            ? { hue: 30 }
            : kind === 'zoom-blur'
              ? {}
              : kind === 'curves'
              ? { curves: { ...defaultCurves(), rgb: [{ x: 0, y: 30 }, { x: 255, y: 255 }] } }
              : {};
      const active = { ...e, ...tweak } as Effect;
      if (kind === 'zoom-blur') continue; // drawn as copies, not as a filter (tested below)
      expect(markup([active]), kind).toContain('<filter');
    }
  });

  it('an untouched tone curve does nothing; a changed one becomes per-channel tables', () => {
    expect(markup([createEffect('curves')])).toBe('');
    const e = createEffect('curves') as Extract<Effect, { kind: 'curves' }>;
    const m = markup([{ ...e, curves: { ...e.curves, g: [{ x: 0, y: 0 }, { x: 255, y: 128 }] } }]);
    expect(m).toMatch(/<feFuncG type="table" tableValues="0 [^"]*0\.502"/);
    expect(m).toMatch(/<feFuncR type="table" tableValues="0 0\.0039 /);
  });

  it('a zoom blur splits the effects into filters before and after its scaled copies', async () => {
    const { DocumentSvg } = await import('../render/DocumentSvg');
    const { splitAtZoomBlur, zoomBlurSteps } = await import('../render/effects');
    const zoom = { ...createEffect('zoom-blur'), amount: 0.5 } as Extract<Effect, { kind: 'zoom-blur' }>;
    const list = [createEffect('color-overlay'), zoom, createEffect('invert')];
    const segs = splitAtZoomBlur(list);
    expect(segs.map((s) => [s.effects.map((e) => e.kind), s.zoom?.kind ?? null])).toEqual([
      [['color-overlay'], 'zoom-blur'],
      [['invert'], null],
    ]);
    // Zero amount / disabled zoom blurs are skipped; copies scale with the travel.
    expect(splitAtZoomBlur([{ ...zoom, amount: 0 }])).toHaveLength(1);
    expect(zoomBlurSteps({ ...zoom, amount: 0.05 }, 100, 100)).toBeLessThan(zoomBlurSteps(zoom, 100, 100));
    expect(zoomBlurSteps({ ...zoom, amount: 2 }, 2000, 2000)).toBe(64);

    const doc = produce(createDocument(200, 200), (d) => {
      const r = createShape(defaultGeometry('rect'), { x: 50, y: 50, width: 100, height: 100, rotation: 0 });
      r.effects = list;
      addObject(d, d.layers[0].id, r);
    });
    const svg = renderToStaticMarkup(createElement(DocumentSvg, { doc, options: { imageHref: () => undefined, idPrefix: 't' } }));
    const n = zoomBlurSteps(zoom, 100, 100);
    expect(svg).toContain(`data-zoom-blur="${n}"`);
    // n copies of the overlay-filtered shape, all inside the inverting filter.
    expect(svg.match(/filter="url\(#t-fx-[^)]*\)"><path/g)).toHaveLength(n);
    expect(svg.indexOf('filter="url(#t-fx-' )).toBeLessThan(svg.indexOf('data-zoom-blur'));
    expect(svg).toMatch(/<g filter="url\(#t-fx-[^"]*-1\)"><g data-zoom-blur/);
  });

  it('skips disabled and zero-strength effects; blends partial strength with the input', () => {
    expect(markup([{ ...createEffect('glow'), enabled: false }, { ...createEffect('invert'), strength: 0 }])).toBe('');
    const m = markup([{ ...createEffect('invert'), strength: 0.25 }]);
    expect(m).toMatch(/operator="arithmetic"[^>]*k2="0.25"[^>]*k3="0.75"/);
  });

  it('chains effects: each takes the previous result as input', () => {
    const m = markup([createEffect('color-overlay'), createEffect('invert')]);
    // The invert reads the overlay's result, not the source graphic.
    const overlayResult = /<feComposite in="e\d+f" in2="SourceGraphic" operator="in" result="(e\d+c)"/.exec(m)![1];
    expect(m).toContain(`<feComponentTransfer in="${overlayResult}"`);
  });

  it('converts the older fixed glow / drop shadow settings', () => {
    expect(migrateLegacyEffects({ glow: { enabled: false }, dropShadow: { enabled: false } })).toEqual([]);
    const m = migrateLegacyEffects({
      glow: { enabled: true, color: '#00ff00', blur: 3, spread: 1, opacity: 0.4 },
      dropShadow: { enabled: true, color: '#111111', opacity: 0.3, angle: 90, distance: 9, blur: 2 },
    });
    expect(m.map((e) => e.kind)).toEqual(['glow', 'drop-shadow']);
    expect(m[0]).toMatchObject({ color: '#00ff00', blur: 3, spread: 1, opacity: 0.4, enabled: true, strength: 1 });
    expect(m[1]).toMatchObject({ color: '#111111', opacity: 0.3, angle: 90, distance: 9, blur: 2 });
  });

  it('loads older files, fills missing settings, and rejects broken effects', async () => {
    const old = await load({ glow: { enabled: true, color: '#ff0000', blur: 1, spread: 1, opacity: 1 }, dropShadow: { enabled: false } });
    expect((old.doc.layers[0].children[0] as { effects: Effect[] }).effects.map((e) => e.kind)).toEqual(['glow']);
    const partial = await load([{ id: 'a', kind: 'blur', enabled: true }]);
    expect((partial.doc.layers[0].children[0] as { effects: Effect[] }).effects[0]).toMatchObject({ kind: 'blur', radius: 4, strength: 1 });
    await expect(load([{ id: 'a', kind: 'lens-flare' }])).rejects.toThrow(ProjectError);
    // Tone curves: points are checked (range, order, count); missing channels are identity.
    const curve = await load([{ id: 'a', kind: 'curves', enabled: true, strength: 1, curves: { rgb: [{ x: 0, y: 20 }, { x: 255, y: 230 }] } }]);
    expect((curve.doc.layers[0].children[0] as { effects: Effect[] }).effects[0]).toMatchObject({
      curves: { rgb: [{ x: 0, y: 20 }, { x: 255, y: 230 }], r: [{ x: 0, y: 0 }, { x: 255, y: 255 }] },
    });
    for (const bad of [[{ x: 0, y: 0 }], [{ x: 10, y: 0 }, { x: 5, y: 9 }], [{ x: 0, y: 0 }, { x: 255, y: 300 }]]) {
      await expect(load([{ id: 'a', kind: 'curves', curves: { rgb: bad } }])).rejects.toThrow(ProjectError);
    }
    await expect(load([{ id: 'a', kind: 'blur', radius: 'big' }])).rejects.toThrow(ProjectError);
  });
});
