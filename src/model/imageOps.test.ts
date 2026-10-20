import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { addObject } from './commands';
import { createDocument, createImage, createShape, defaultGeometry } from './factory';
import { coversCanvas, cropDocument, cropImage, fitCanvasToObject, resizeCanvas, resizeImagePixels, selectionToImageMask } from './imageOps';
import { findObject } from './tree';
import type { AssetMeta, ImageObject, SparcaDocument } from './types';

const asset: AssetMeta = { id: 'a1', mimeType: 'image/png', width: 400, height: 200, fileName: 'a.png' };

function setup(w = 1200, h = 800) {
  const img = createImage(asset, { x: 100, y: 100, width: 400, height: 200, rotation: 0 });
  const shape = createShape(defaultGeometry('rect'), { x: 0, y: 0, width: 50, height: 50, rotation: 0 });
  const doc = produce(createDocument(w, h), (d) => {
    d.assets.a1 = asset;
    addObject(d, d.layers[0].id, img);
    addObject(d, d.layers[0].id, shape);
    d.layers[0].locked = true; // document-level ops must still move locked content
  });
  return { doc, img: img.id, shape: shape.id };
}

const box = (doc: SparcaDocument, id: string) => {
  const o = findObject(doc, id)!.object;
  if (o.type === 'group') throw new Error();
  return o.box;
};

describe('canvas size (spec §7.3 examples)', () => {
  it('1200→1400 wide, centered: adds 100px on each side', () => {
    const { doc, shape } = setup();
    const out = produce(doc, (d) => resizeCanvas(d, 1400, 800, { x: 0.5, y: 0.5 }));
    expect(out.width).toBe(1400);
    expect(box(out, shape).x).toBe(100);
    expect(box(out, shape).y).toBe(0);
  });

  it('800→1000 high, top-left anchor: adds space right and bottom', () => {
    const { doc, shape } = setup();
    const out = produce(doc, (d) => resizeCanvas(d, 1200, 1000, { x: 0, y: 0 }));
    expect(box(out, shape)).toMatchObject({ x: 0, y: 0 });
    expect(out.height).toBe(1000);
  });

  it('1200→1000 wide, right-center anchor: cuts 200px from the left', () => {
    const { doc, shape, img } = setup();
    const out = produce(doc, (d) => resizeCanvas(d, 1000, 800, { x: 1, y: 0.5 }));
    expect(box(out, shape).x).toBe(-200);
    // Content is not scaled and stays in the document even when outside the canvas.
    expect(box(out, shape).width).toBe(50);
    expect(box(out, img)).toMatchObject({ x: -100, width: 400 });
    expect(findObject(out, shape)).not.toBeNull();
  });
});

describe('document crop vs image crop', () => {
  it('document crop changes canvas and moves content, images keep their pixels', () => {
    const { doc, img } = setup();
    const out = produce(doc, (d) => cropDocument(d, { x: 150, y: 120, width: 300, height: 100 }));
    expect([out.width, out.height]).toEqual([300, 100]);
    expect(box(out, img)).toMatchObject({ x: -50, y: -20, width: 400, height: 200 });
    expect((findObject(out, img)!.object as ImageObject).pipeline.crop).toBeNull();
  });

  it('image crop changes only that image (source crop + box), not the canvas', () => {
    const { doc, img } = setup();
    const out = produce(doc, (d) => cropImage(d, img, { x: 0.25, y: 0, width: 0.5, height: 0.5 }, 400, 200));
    expect([out.width, out.height]).toEqual([1200, 800]);
    const o = findObject(out, img)!.object as ImageObject;
    expect(o.pipeline.crop).toEqual({ x: 100, y: 0, width: 200, height: 100 });
    expect(o.box).toMatchObject({ x: 200, y: 100, width: 200, height: 100 });
    // Cropping again composes with the previous crop.
    const out2 = produce(out, (d) => cropImage(d, img, { x: 0.5, y: 0, width: 0.5, height: 1 }, 400, 200));
    expect((findObject(out2, img)!.object as ImageObject).pipeline.crop).toEqual({ x: 200, y: 0, width: 100, height: 100 });
  });
});

describe('image pixel resize', () => {
  it('sets pipeline resize and shows pixels 1:1 around the center', () => {
    const { doc, img } = setup();
    const out = produce(doc, (d) => resizeImagePixels(d, img, 800, 400, 'lanczos', 400, 200));
    const o = findObject(out, img)!.object as ImageObject;
    expect(o.pipeline.resize).toEqual({ width: 800, height: 400, method: 'lanczos' });
    expect(o.box).toMatchObject({ x: -100, y: 0, width: 800, height: 400 });
    // Back to the original size removes the resize step (original kept, change reversible).
    const back = produce(out, (d) => resizeImagePixels(d, img, 400, 200, 'bicubic', 400, 200));
    expect((findObject(back, img)!.object as ImageObject).pipeline.resize).toBeNull();
  });
});

describe('selection masks', () => {
  it('maps a document-space selection into image-normalized coordinates', () => {
    const { doc, img } = setup();
    const o = findObject(doc, img)!.object as ImageObject;
    expect(selectionToImageMask(o, { kind: 'rect', x: 200, y: 150, width: 100, height: 50 })).toEqual({
      kind: 'rect', x: 0.25, y: 0.25, width: 0.25, height: 0.25,
    });
    const rotated = { ...o, box: { ...o.box, rotation: 90 } };
    const m = selectionToImageMask(rotated, { kind: 'rect', x: 0, y: 0, width: 10, height: 10 });
    expect(m.kind).toBe('polygon');
  });
});

describe('fit canvas to an image after resizing it', () => {
  it('canvas becomes the new image size; image at (0,0); other objects keep their offset', () => {
    const { doc, img, shape } = setup(400, 200);
    // Image covering the whole 400×200 canvas.
    const covering = produce(doc, (d) => {
      const o = findObject(d, img)!.object as ImageObject;
      o.box = { x: 0, y: 0, width: 400, height: 200, rotation: 0 };
    });
    expect(coversCanvas(covering, img)).toBe(true);
    expect(coversCanvas(covering, shape)).toBe(false);
    const out = produce(covering, (d) => {
      resizeImagePixels(d, img, 200, 100, 'bicubic', 400, 200); // keeps the center → box at (100, 50)
      fitCanvasToObject(d, img);
    });
    expect([out.width, out.height]).toEqual([200, 100]);
    expect(box(out, img)).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
    expect(box(out, shape)).toMatchObject({ x: -100, y: -50, width: 50 }); // moved with the image, not scaled
  });

  it('lands exactly at (0,0) even when the resized image sits on a half pixel', () => {
    const { doc, img } = setup(401, 201);
    const out = produce(doc, (d) => {
      const o = findObject(d, img)!.object as ImageObject;
      o.box = { x: 0, y: 0, width: 401, height: 201, rotation: 0 };
      resizeImagePixels(d, img, 200, 100, 'bicubic', 400, 200); // center 200.5 → x = 100.5
      fitCanvasToObject(d, img);
    });
    expect(box(out, img)).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
    expect([out.width, out.height]).toEqual([200, 100]);
  });
});
