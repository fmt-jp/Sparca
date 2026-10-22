// Japanese font names from a font file's 'name' table. Chrome's Local Font Access API
// reports English names only, so fonts like "AR板体E" would otherwise appear (and be
// searchable) only under their English names.

/** Reads `length` bytes at `offset` (a Blob slice, so only those bytes are loaded). */
type Reader = (offset: number, length: number) => Promise<DataView>;

const JAPANESE = 0x0411;
const WINDOWS = 3;
const FAMILY = 1;
const POSTSCRIPT = 6;
const TYPOGRAPHIC_FAMILY = 16;

interface FontNames {
  postscript: string | null;
  /** Japanese family name (typographic family preferred), if the font has one. */
  japaneseFamily: string | null;
}

function utf16be(view: DataView, start: number, length: number): string {
  let s = '';
  for (let i = 0; i + 1 < length; i += 2) s += String.fromCharCode(view.getUint16(start + i));
  return s;
}

/** Names of the font whose table directory starts at `base` (0 for a single font). */
async function readNames(read: Reader, base: number): Promise<FontNames> {
  const dir = await read(base, 12);
  const numTables = dir.getUint16(4);
  const records = await read(base + 12, numTables * 16);
  let nameOffset = -1;
  let nameLength = 0;
  for (let i = 0; i < numTables; i++) {
    const tag = String.fromCharCode(records.getUint8(i * 16), records.getUint8(i * 16 + 1), records.getUint8(i * 16 + 2), records.getUint8(i * 16 + 3));
    if (tag === 'name') {
      nameOffset = records.getUint32(i * 16 + 8);
      nameLength = records.getUint32(i * 16 + 12);
    }
  }
  if (nameOffset < 0) return { postscript: null, japaneseFamily: null };
  const t = await read(nameOffset, nameLength);
  const count = t.getUint16(2);
  const strings = t.getUint16(4);
  let postscript: string | null = null;
  let family: string | null = null;
  let typographic: string | null = null;
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > t.byteLength) break;
    const platform = t.getUint16(r);
    const language = t.getUint16(r + 4);
    const id = t.getUint16(r + 6);
    const len = t.getUint16(r + 8);
    const off = strings + t.getUint16(r + 10);
    if (platform !== WINDOWS || off + len > t.byteLength) continue;
    if (id === POSTSCRIPT && !postscript) postscript = utf16be(t, off, len);
    if (language !== JAPANESE) continue;
    if (id === FAMILY) family = utf16be(t, off, len);
    if (id === TYPOGRAPHIC_FAMILY) typographic = utf16be(t, off, len);
  }
  return { postscript, japaneseFamily: typographic || family };
}

/**
 * Japanese family name of a font file (TrueType / OpenType / collection). In a collection
 * the font whose PostScript name matches `postscriptName` is used. Null when the font has
 * no Japanese name or the file cannot be read.
 */
export async function japaneseFamilyName(blob: Blob, postscriptName?: string): Promise<string | null> {
  const read: Reader = async (offset, length) => new DataView(await blob.slice(offset, offset + length).arrayBuffer());
  try {
    const head = await read(0, 12);
    const tag = String.fromCharCode(head.getUint8(0), head.getUint8(1), head.getUint8(2), head.getUint8(3));
    if (tag !== 'ttcf') return (await readNames(read, 0)).japaneseFamily;
    const n = head.getUint32(8);
    const offsets = await read(12, n * 4);
    let first: string | null = null;
    for (let i = 0; i < n; i++) {
      const names = await readNames(read, offsets.getUint32(i * 4));
      first ??= names.japaneseFamily;
      if (postscriptName && names.postscript === postscriptName) return names.japaneseFamily;
    }
    return first;
  } catch {
    return null;
  }
}
