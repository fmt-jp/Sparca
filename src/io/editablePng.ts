// 編集できる PNG (.hnb.png; decided with the user 2026-11-03, as Fireworks' editable PNG):
// an ordinary PNG of the canvas (what PNG export gives) that also carries the whole .hnb
// project (the ZIP) in a private chunk. Image viewers and Windows Explorer show the picture;
// HANABI opens the project. Another program saving over it drops the chunk (it is marked
// unsafe to copy), leaving a plain PNG.

export const EDITABLE_PNG_EXTENSION = '.hnb.png';

/** Private, ancillary, unsafe-to-copy chunk ("hnBZ") holding the .hnb ZIP bytes. */
const CHUNK = 'hnBZ';
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Largest chunk the PNG format allows. */
const MAX_CHUNK = 0x7fffffff;

export class EditablePngError extends Error {}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

/** Whether a file name says it is an editable PNG (or any PNG, which is saved as one). */
export function isEditablePngName(name: string): boolean {
  return name.toLowerCase().endsWith('.png');
}

let crcTable: Uint32Array | null = null;
function crc32(parts: Uint8Array[]): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = crcTable[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const ascii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

/** Chunks of a PNG: type, data offset and length; throws on a malformed file. */
function chunks(png: Uint8Array): { type: string; start: number; data: number; length: number }[] {
  if (!isPng(png)) throw new EditablePngError('PNG ファイルではありません。');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; start: number; data: number; length: number }[] = [];
  let p = 8;
  while (p + 12 <= png.length) {
    const length = view.getUint32(p);
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    if (p + 12 + length > png.length) throw new EditablePngError('PNG ファイルが途中で切れています。');
    out.push({ type, start: p, data: p + 8, length });
    p += 12 + length;
    if (type === 'IEND') break;
  }
  if (out[out.length - 1]?.type !== 'IEND') throw new EditablePngError('PNG ファイルが途中で切れています。');
  return out;
}

/** The PNG with the project bytes added as a chunk just before IEND. */
export function embedProject(png: Uint8Array, project: Uint8Array): Uint8Array {
  if (project.length > MAX_CHUNK) throw new EditablePngError('プロジェクトが大きすぎるため、編集できる PNG に保存できません。.hnb 形式で保存してください。');
  const list = chunks(png).filter((c) => c.type !== CHUNK);
  const iend = list[list.length - 1];
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, project.length);
  head.set(ascii(CHUNK), 4);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32([head.subarray(4), project]));
  const before = list.slice(0, -1);
  const size = 8 + before.reduce((n, c) => n + 12 + c.length, 0) + 12 + project.length + 12;
  const out = new Uint8Array(size);
  out.set(png.subarray(0, 8), 0);
  let o = 8;
  for (const c of before) {
    out.set(png.subarray(c.start, c.start + 12 + c.length), o);
    o += 12 + c.length;
  }
  out.set(head, o);
  out.set(project, o + 8);
  out.set(crc, o + 8 + project.length);
  o += 12 + project.length;
  out.set(png.subarray(iend.start, iend.start + 12), o);
  return out;
}

/** The project bytes carried by an editable PNG, or null for a plain PNG. Throws on a damaged chunk. */
export function extractProject(png: Uint8Array): Uint8Array | null {
  const c = chunks(png).find((k) => k.type === CHUNK);
  if (!c) return null;
  const data = png.subarray(c.data, c.data + c.length);
  const stored = new DataView(png.buffer, png.byteOffset + c.data + c.length, 4).getUint32(0);
  if (stored !== crc32([png.subarray(c.start + 4, c.start + 8), data])) {
    throw new EditablePngError('編集できる PNG の HANABI のデータが壊れています。');
  }
  return data;
}
