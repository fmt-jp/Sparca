// 自動選択 (magic wand; 2026-11-15): the pixels whose color is close to the clicked one —
// every channel (R, G, B and alpha) within `tolerance` — either connected to it (4-way) or
// anywhere in the image.

/** Coverage (0 / 255) of the pixels like the one at (x, y) in RGBA `data` (w×h). */
export function similarRegion(data: Uint8ClampedArray, w: number, h: number, x: number, y: number, tolerance: number, contiguous: boolean): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  if (x < 0 || y < 0 || x >= w || y >= h) return out;
  const s = (y * w + x) * 4;
  const r0 = data[s];
  const g0 = data[s + 1];
  const b0 = data[s + 2];
  const a0 = data[s + 3];
  const like = (i: number) => {
    const d = i * 4;
    return Math.abs(data[d] - r0) <= tolerance && Math.abs(data[d + 1] - g0) <= tolerance && Math.abs(data[d + 2] - b0) <= tolerance && Math.abs(data[d + 3] - a0) <= tolerance;
  };
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (like(i)) out[i] = 255;
    return out;
  }
  // Scanline flood fill.
  const stack = [y * w + x];
  out[y * w + x] = 255;
  while (stack.length) {
    const i = stack.pop()!;
    const px = i % w;
    const py = (i - px) / w;
    const push = (j: number) => {
      if (!out[j] && like(j)) {
        out[j] = 255;
        stack.push(j);
      }
    };
    if (px > 0) push(i - 1);
    if (px < w - 1) push(i + 1);
    if (py > 0) push(i - w);
    if (py < h - 1) push(i + w);
  }
  return out;
}
