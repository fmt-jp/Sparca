import JSZip from 'jszip';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { addLayer, addObject, groupObjects } from '../model/commands';
import { createDocument, createImage, createShape, createText, defaultGeometry } from '../model/factory';
import type { AssetMeta, ImageObject, SparcaDocument } from '../model/types';
import { createEffect } from '../model/effects';
import { ProjectError, READ_LIMITS, readProject, writeProject } from './project';

const asset: AssetMeta = { id: 'a_1', mimeType: 'image/png', width: 2, height: 2, fileName: 'x.png' };
// PNG signature + some bytes (the reader checks the data really is the recorded format).
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

function sampleDoc(): SparcaDocument {
  return produce(createDocument(640, 480), (d) => {
    d.assets[asset.id] = asset;
    const l2 = addLayer(d);
    l2.locked = true;
    const img = createImage(asset, { x: 1, y: 2, width: 20, height: 20, rotation: 15 });
    img.pipeline.adjust.brightness = 30;
    img.pipeline.localEdits = [
      { kind: 'blur', radius: 4, mask: { kind: 'rect', x: 0, y: 0, width: 0.5, height: 0.5 } },
      { kind: 'mosaic', size: 8, mask: { kind: 'ellipse', x: 0.2, y: 0.2, width: 0.5, height: 0.5 } },
    ];
    addObject(d, d.layers[0].id, img);
    const star = createShape({ kind: 'star', points: 7, innerRatio: 0.3 }, { x: 5, y: 5, width: 50, height: 50, rotation: 0 });
    star.strokeStyle = 'dashed';
    star.effects = [createEffect('drop-shadow'), { ...createEffect('bevel-outer'), strength: 0.5, enabled: false }];
    addObject(d, l2.id, star);
    const t = createText('こんにちは\n2行目', { x: 0, y: 0, width: 100, height: 40, rotation: 0 });
    t.effects = [createEffect('glow'), createEffect('glow'), createEffect('hue-saturation')];
    addObject(d, l2.id, t);
    addObject(d, l2.id, createShape(defaultGeometry('arrow'), { x: 0, y: 0, width: 10, height: 10, rotation: 0 }));
    star.fill = { kind: 'conic', start: { x: 0.5, y: 0.5 }, end: { x: 1, y: 0.2 }, stops: [{ offset: 0, color: '#ff0000', opacity: 1 }, { offset: 0.4, color: '#00ff00', opacity: 0.5 }, { offset: 1, color: '#0000ff', opacity: 1 }] };
    t.color = { kind: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, stops: [{ offset: 0, color: '#111111', opacity: 1 }, { offset: 1, color: '#eeeeee', opacity: 1 }] };
    groupObjects(d, [t.id, l2.children[2].id]);
    d.background = { kind: 'transparent' };
  });
}

describe('project format', () => {
  it('round-trips a document with layers, groups, effects and images', async () => {
    const doc = sampleDoc();
    const data = await writeProject(doc, (id) => (id === asset.id ? new Blob([bytes]) : undefined));
    const loaded = await readProject(data);
    expect(loaded.doc).toEqual(doc);
    const blob = loaded.assets.get(asset.id)!;
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(blob.type).toBe('image/png');
  });

  it('drops metadata of assets no longer referenced', async () => {
    const doc = produce(sampleDoc(), (d) => {
      d.assets.unused = { id: 'unused', mimeType: 'image/png', width: 1, height: 1, fileName: '' };
    });
    const data = await writeProject(doc, () => new Blob([bytes]));
    const loaded = await readProject(data);
    expect(Object.keys(loaded.doc.assets)).toEqual([asset.id]);
  });

  it('rejects files that are not projects', async () => {
    await expect(readProject(new Uint8Array([1, 2, 3]))).rejects.toThrow(ProjectError);
  });

  it('rejects projects with missing image data', async () => {
    const data = await writeProject(sampleDoc(), () => new Blob([bytes]));
    const zip = await JSZip.loadAsync(data);
    zip.remove('assets/a_1.png');
    const broken = await zip.generateAsync({ type: 'uint8array' });
    await expect(readProject(broken)).rejects.toThrow(/x\.png/);
  });

  it('rejects malformed document.json', async () => {
    const zip = new JSZip();
    zip.file('document.json', JSON.stringify({ version: 1, width: -5, height: 10, layers: [], assets: {}, background: { kind: 'transparent' } }));
    await expect(readProject(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/寸法/);
  });

  it('rejects gradients with fewer than two colors or offsets out of range', async () => {
    for (const fill of [
      { kind: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, stops: [{ offset: 0, color: '#000000', opacity: 1 }] },
      { kind: 'radial', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, stops: [{ offset: 0, color: '#000000', opacity: 1 }, { offset: 2, color: '#ffffff', opacity: 1 }] },
      { kind: 'spiral', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, stops: [] },
    ]) {
      const doc = produce(createDocument(10, 10), (d) => {
        addObject(d, d.layers[0].id, createShape(defaultGeometry('rect'), { x: 0, y: 0, width: 5, height: 5, rotation: 0 }));
      });
      const raw = JSON.parse(JSON.stringify(doc));
      raw.layers[0].children[0].fill = fill;
      const zip = new JSZip();
      zip.file('document.json', JSON.stringify(raw));
      await expect(readProject(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(ProjectError);
    }
  });

  it('rejects an unknown line style', async () => {
    const doc = produce(createDocument(10, 10), (d) => {
      addObject(d, d.layers[0].id, createShape(defaultGeometry('rect'), { x: 0, y: 0, width: 5, height: 5, rotation: 0 }));
    });
    const raw = JSON.parse(JSON.stringify(doc));
    raw.layers[0].children[0].strokeStyle = 'wavy';
    const zip = new JSZip();
    zip.file('document.json', JSON.stringify(raw));
    await expect(readProject(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(ProjectError);
  });

  it('rejects image edits of unknown kinds or with a broken mosaic size', async () => {
    for (const edit of [{ kind: 'swirl', mask: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 } }, { kind: 'mosaic', size: 0, mask: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 } }]) {
      const doc = sampleDoc();
      const raw = JSON.parse(JSON.stringify(doc));
      raw.layers[0].children[0].pipeline.localEdits = [edit];
      const zip = new JSZip();
      zip.file('document.json', JSON.stringify(raw));
      zip.file('assets/a_1.png', bytes);
      await expect(readProject(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(ProjectError);
    }
  });

  it('turns an older image tone and whole-image blur into the same-named effects', async () => {
    const raw = JSON.parse(JSON.stringify(sampleDoc()));
    const img = raw.layers[0].children[0];
    img.pipeline.adjust.tone = 'sepia';
    img.pipeline.adjust.toneAmount = 60;
    img.pipeline.blur = 5; // older whole-image blur
    img.effects = [{ ...createEffect('glow') }];
    const zip = new JSZip();
    zip.file('document.json', JSON.stringify(raw));
    zip.file('assets/a_1.png', bytes);
    const loaded = await readProject(await zip.generateAsync({ type: 'uint8array' }));
    const out = loaded.doc.layers[0].children[0] as ImageObject;
    expect(out.effects.map((e) => [e.kind, e.strength])).toEqual([
      ['sepia', 0.6],
      ['blur', 1],
      ['glow', 1],
    ]);
    expect(out.effects[1]).toMatchObject({ radius: 5 });
    expect(out.pipeline).not.toHaveProperty('blur');
    expect(out.pipeline.adjust).not.toHaveProperty('tone');
    expect(out.pipeline.adjust).not.toHaveProperty('toneAmount');
  });

  it('refuses to save when image data is missing', async () => {
    await expect(writeProject(sampleDoc(), () => undefined)).rejects.toThrow(ProjectError);
  });

  it('refuses oversized content (ZIP bombs) with a message', async () => {
    const data = await writeProject(sampleDoc(), () => new Blob([bytes]));
    await expect(readProject(data, { ...READ_LIMITS, fileBytes: 100 })).rejects.toThrow(/ファイルが大きすぎる/);
    await expect(readProject(data, { ...READ_LIMITS, jsonBytes: 1000 })).rejects.toThrow(/document\.json が大きすぎる/);
    await expect(readProject(data, { ...READ_LIMITS, assetBytes: 5 })).rejects.toThrow(/画像「x\.png」が大きすぎる/);
    // A highly compressible entry is cut off while expanding, whatever its header says.
    const zip = await JSZip.loadAsync(data);
    zip.file('document.json', '{"pad":"' + ' '.repeat(5 * 1024 * 1024) + '"}');
    const bomb = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    expect(bomb.length).toBeLessThan(100 * 1024);
    await expect(readProject(bomb, { ...READ_LIMITS, jsonBytes: 1024 * 1024 })).rejects.toThrow(ProjectError);
    // Within the limits it still opens.
    await expect(readProject(data)).resolves.toBeTruthy();
  });

  it('accepts only supported image formats whose data matches', async () => {
    const data = await writeProject(sampleDoc(), () => new Blob([bytes]));
    const zip = await JSZip.loadAsync(data);
    const raw = JSON.parse(await zip.file('document.json')!.async('string'));
    // Recorded as HTML.
    const html = await JSZip.loadAsync(data);
    html.file('document.json', JSON.stringify({ ...raw, assets: { a_1: { ...raw.assets.a_1, mimeType: 'text/html' } } }));
    html.file('assets/a_1.bin', '<script>alert(1)</script>');
    await expect(readProject(await html.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/形式（text\/html）には対応していません/);
    // Recorded as PNG, but the data is not a PNG.
    const fake = await JSZip.loadAsync(data);
    fake.file('assets/a_1.png', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await expect(readProject(await fake.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/image\/png の画像ではありません/);
    // Impossible sizes.
    const huge = await JSZip.loadAsync(data);
    huge.file('document.json', JSON.stringify({ ...raw, assets: { a_1: { ...raw.assets.a_1, width: 100000, height: 100000 } } }));
    await expect(readProject(await huge.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/大きさ/);
  });

  it('round-trips compound paths (subpaths) and rejects broken ones', async () => {
    const doc = produce(createDocument(100, 100), (d) => {
      d.layers[0].children.push({
        id: 'cp', name: 'パス', type: 'path', visible: true, locked: false, opacity: 1, effects: [],
        box: { x: 0, y: 0, width: 100, height: 100, rotation: 0 }, fill: '#ff0000', stroke: null, strokeWidth: 0,
        nodes: [{ anchor: { x: 0, y: 0 }, in: null, out: null }, { anchor: { x: 1, y: 0 }, in: null, out: null }, { anchor: { x: 1, y: 1 }, in: null, out: null }],
        closed: true,
        subpaths: [{ nodes: [{ anchor: { x: 0.4, y: 0.4 }, in: null, out: null }, { anchor: { x: 0.6, y: 0.4 }, in: null, out: null }, { anchor: { x: 0.5, y: 0.6 }, in: null, out: null }], closed: true }],
      });
    });
    const back = await readProject(await writeProject(doc, () => undefined));
    expect(back.doc.layers[0].children[0]).toMatchObject({ subpaths: [{ closed: true, nodes: [{ anchor: { x: 0.4, y: 0.4 } }, {}, {}] }] });
    const raw = JSON.parse(JSON.stringify(doc));
    raw.layers[0].children[0].subpaths = [{ nodes: [{ x: 1 }], closed: true }];
    const zip = new JSZip();
    zip.file('document.json', JSON.stringify(raw));
    await expect(readProject(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/subpaths/);
  });
});
