import JSZip from 'jszip';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { addLayer, addObject, groupObjects } from '../model/commands';
import { createDocument, createImage, createShape, createText, defaultGeometry } from '../model/factory';
import type { AssetMeta, SparcaDocument } from '../model/types';
import { createEffect } from '../model/effects';
import { ProjectError, readProject, writeProject } from './project';

const asset: AssetMeta = { id: 'a_1', mimeType: 'image/png', width: 2, height: 2, fileName: 'x.png' };
const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

function sampleDoc(): SparcaDocument {
  return produce(createDocument(640, 480), (d) => {
    d.assets[asset.id] = asset;
    const l2 = addLayer(d);
    l2.locked = true;
    const img = createImage(asset, { x: 1, y: 2, width: 20, height: 20, rotation: 15 });
    img.pipeline.adjust.brightness = 30;
    addObject(d, d.layers[0].id, img);
    const star = createShape({ kind: 'star', points: 7, innerRatio: 0.3 }, { x: 5, y: 5, width: 50, height: 50, rotation: 0 });
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

  it('refuses to save when image data is missing', async () => {
    await expect(writeProject(sampleDoc(), () => undefined)).rejects.toThrow(ProjectError);
  });
});
