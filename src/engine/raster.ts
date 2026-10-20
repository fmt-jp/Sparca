// Engine-level raster type: straight (non-premultiplied) RGBA, 8 bits per channel.
// Structurally compatible with ImageData so it can be passed to/from canvases directly.

export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function createRaster(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneRaster(r: Raster): Raster {
  return { width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) };
}

export function fillRaster(r: Raster, rgba: [number, number, number, number]): Raster {
  for (let i = 0; i < r.data.length; i += 4) {
    r.data[i] = rgba[0];
    r.data[i + 1] = rgba[1];
    r.data[i + 2] = rgba[2];
    r.data[i + 3] = rgba[3];
  }
  return r;
}

/** Copy a sub-rectangle (clamped to the raster). */
export function cropRaster(r: Raster, x: number, y: number, width: number, height: number): Raster {
  const x0 = Math.max(0, Math.min(r.width - 1, Math.round(x)));
  const y0 = Math.max(0, Math.min(r.height - 1, Math.round(y)));
  const w = Math.max(1, Math.min(r.width - x0, Math.round(width)));
  const h = Math.max(1, Math.min(r.height - y0, Math.round(height)));
  const out = createRaster(w, h);
  for (let row = 0; row < h; row++) {
    const s = ((y0 + row) * r.width + x0) * 4;
    out.data.set(r.data.subarray(s, s + w * 4), row * w * 4);
  }
  return out;
}

export function pixel(r: Raster, x: number, y: number): [number, number, number, number] {
  const i = (y * r.width + x) * 4;
  return [r.data[i], r.data[i + 1], r.data[i + 2], r.data[i + 3]];
}
