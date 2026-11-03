import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { addObject } from '../model/commands';
import { createDocument, createShape, defaultGeometry } from '../model/factory';
import { embedProject, extractProject, isPng } from './editablePng';
import { ProjectError, readProject, writeProject } from './project';

/** A minimal PNG: signature, IHDR, IDAT, IEND (CRCs are not checked by the reader). */
function fakePng(): Uint8Array {
  const chunk = (type: string, data: number[]) => {
    const len = [0, 0, 0, data.length];
    return [...len, ...Array.from(type, (c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  };
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...chunk('IDAT', [1, 2, 3]),
    ...chunk('IEND', []),
  ]);
}

describe('編集できる PNG', () => {
  it('carries the project in a chunk before IEND and gives it back', () => {
    const png = fakePng();
    const project = new Uint8Array([0x50, 0x4b, 1, 2, 3, 4, 5]);
    const out = embedProject(png, project);
    expect(isPng(out)).toBe(true);
    expect(Array.from(extractProject(out)!)).toEqual(Array.from(project));
    // Still ends with IEND, and the image chunks are untouched.
    expect(String.fromCharCode(...out.subarray(out.length - 8, out.length - 4))).toBe('IEND');
    expect(Array.from(out.subarray(0, png.length - 12))).toEqual(Array.from(png.subarray(0, png.length - 12)));
    // Saving again replaces the chunk instead of adding another.
    const again = embedProject(out, new Uint8Array([9]));
    expect(Array.from(extractProject(again)!)).toEqual([9]);
    expect(again.length).toBe(png.length + 12 + 1);
    // A plain PNG has none.
    expect(extractProject(png)).toBeNull();
  });

  it('notices a damaged chunk', () => {
    const out = embedProject(fakePng(), new Uint8Array([1, 2, 3]));
    out[out.length - 12 - 4 - 2] ^= 0xff; // a byte of the project data
    expect(() => extractProject(out)).toThrow(/壊れています/);
  });

  it('opens as the project; a plain PNG is refused with what to do', async () => {
    const doc = produce(createDocument(30, 20), (d) => {
      addObject(d, d.layers[0].id, createShape(defaultGeometry('rect'), { x: 1, y: 2, width: 3, height: 4, rotation: 0 }));
    });
    const data = await writeProject(doc, () => undefined);
    const loaded = await readProject(embedProject(fakePng(), data));
    expect(loaded.doc.layers[0].children).toHaveLength(1);
    expect(loaded.doc.width).toBe(30);
    await expect(readProject(fakePng())).rejects.toThrow(ProjectError);
    await expect(readProject(fakePng())).rejects.toThrow(/画像として開いてください/);
  });
});
