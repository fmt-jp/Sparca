// Test helper: a minimal font file with the given Windows name records (used by unit and E2E tests).
const WINDOWS = 3;

/** `base`: where this font will sit in a collection file (table offsets are file-relative). */
export function buildTestFont(names: { id: number; language: number; text: string }[], base = 0): Uint8Array {
  const strings = names.map((n) => {
    const b = new Uint8Array(n.text.length * 2);
    for (let i = 0; i < n.text.length; i++) {
      b[i * 2] = n.text.charCodeAt(i) >> 8;
      b[i * 2 + 1] = n.text.charCodeAt(i) & 255;
    }
    return b;
  });
  const headerLen = 6 + names.length * 12;
  const nameLen = headerLen + strings.reduce((s, b) => s + b.length, 0);
  const nameOffset = 12 + 16;
  const out = new Uint8Array(nameOffset + nameLen);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, 1);
  out.set([110, 97, 109, 101], 12); // 'name'
  v.setUint32(12 + 8, base + nameOffset);
  v.setUint32(12 + 12, nameLen);
  v.setUint16(nameOffset + 2, names.length);
  v.setUint16(nameOffset + 4, headerLen);
  let strOff = 0;
  names.forEach((n, i) => {
    const r = nameOffset + 6 + i * 12;
    v.setUint16(r, WINDOWS);
    v.setUint16(r + 2, 1);
    v.setUint16(r + 4, n.language);
    v.setUint16(r + 6, n.id);
    v.setUint16(r + 8, strings[i].length);
    v.setUint16(r + 10, strOff);
    out.set(strings[i], nameOffset + headerLen + strOff);
    strOff += strings[i].length;
  });
  return out;
}

/** A font collection (.ttc) of the given fonts' name records. */
export function buildTestCollection(fonts: { id: number; language: number; text: string }[][]): Uint8Array {
  const headerLen = 12 + fonts.length * 4;
  const parts: Uint8Array[] = [];
  let at = headerLen;
  for (const f of fonts) {
    const b = buildTestFont(f, at);
    parts.push(b);
    at += b.length;
  }
  const out = new Uint8Array(at);
  const v = new DataView(out.buffer);
  out.set([116, 116, 99, 102]); // 'ttcf'
  v.setUint32(4, 0x00010000);
  v.setUint32(8, fonts.length);
  let off = headerLen;
  parts.forEach((b, i) => {
    v.setUint32(12 + i * 4, off);
    out.set(b, off);
    off += b.length;
  });
  return out;
}
