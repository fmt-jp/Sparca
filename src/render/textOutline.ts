// テキストのアウトライン化 (decided with the user 2026-11-14): a text object's letters as
// outlines in document coordinates, to become one path.
//
// Where each letter goes is taken from the browser's own layout of the text (the same SVG as on
// screen: line breaks, alignment, letter spacing, text on a path), so the outline sits exactly
// where the text was. The shapes of the letters come from:
// 1. the font file (Chrome / Edge: Local Font Access, parsed with opentype.js): exact outlines,
//    merged where a glyph's contours overlap (paths are filled even-odd);
// 2. otherwise (a generic family, a style the font has no face for, a letter it lacks, another
//    browser) by tracing the text drawn alone at a high resolution: closely approximated.
import type { Font, PathCommand } from 'opentype.js';
import { loadPathBoolean } from '../lazy';
import { objectBounds } from '../model/geometry';
import type { DocContour, DocNode } from '../model/pathEdit';
import type { Layer, Point, SparcaDocument, TextObject } from '../model/types';
import { traceOutlines } from '../engine/trace';
import { canListLocalFonts, GENERIC_FAMILIES } from './fonts';
import { collectionOffset } from './fontNames';
import { documentSvgMarkup, rasterizeDocument } from './rasterize';

export interface TextOutline {
  contours: DocContour[];
  /** True when the letters were traced (no usable font file). */
  traced: boolean;
}

/** A document holding only `o`, plain: black, without effects, mask or transparency. */
function aloneDoc(doc: SparcaDocument, o: TextObject, width = doc.width, height = doc.height): SparcaDocument {
  const plain: TextObject = { ...o, color: '#000000', effects: [], opacity: 1, visible: true };
  delete plain.mask;
  const layer: Layer = { ...doc.layers[0], id: 'outline', visible: true, locked: false, children: [plain] };
  return { ...doc, width, height, background: { kind: 'transparent' }, layers: [layer] };
}

/** Each letter of the text with the matrix placing a glyph (origin on its baseline) in the document. */
async function placements(doc: SparcaDocument, o: TextObject): Promise<{ ch: string; m: DOMMatrix }[]> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;z-index:-1';
  host.innerHTML = await documentSvgMarkup(aloneDoc(doc, o));
  document.body.append(host);
  try {
    const out: { ch: string; m: DOMMatrix }[] = [];
    for (const el of host.querySelectorAll<SVGTextElement>('text')) {
      const ctm = el.getCTM();
      if (!ctm) continue;
      const base = new DOMMatrix([ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f]);
      const s = el.textContent ?? '';
      for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        const pair = code >= 0xd800 && code < 0xdc00 && i + 1 < s.length;
        const ch = pair ? s.slice(i, i + 2) : s[i];
        try {
          if (!/\s/.test(ch)) {
            const p = el.getStartPositionOfChar(i);
            out.push({ ch, m: base.translate(p.x, p.y).rotate(el.getRotationOfChar(i)) });
          }
        } catch {
          // A letter the browser did not lay out (nothing to draw).
        }
        if (pair) i++;
      }
    }
    return out;
  } finally {
    host.remove();
  }
}

type LocalFontData = { family: string; postscriptName?: string; style?: string; blob(): Promise<Blob> };

/** The font file the text is drawn with (its family and style), or null when it cannot be had. */
async function fontFile(o: TextObject): Promise<Font | null> {
  if (GENERIC_FAMILIES.includes(o.fontFamily) || !canListLocalFonts()) return null;
  let fonts: LocalFontData[];
  try {
    fonts = await (window as unknown as { queryLocalFonts(): Promise<LocalFontData[]> }).queryLocalFonts();
  } catch {
    return null;
  }
  const bold = (s: string) => /bold|black|heavy/i.test(s);
  const italic = (s: string) => /italic|oblique/i.test(s);
  // A face of the same weight and slant; else the browser synthesizes it (traced instead).
  const faces = fonts.filter((f) => f.family === o.fontFamily && bold(f.style ?? '') === o.bold && italic(f.style ?? '') === o.italic);
  if (!faces.length) return null;
  const face = faces.find((f) => /^(regular|normal|book|roman|bold|italic|bold italic|bold oblique|oblique)$/i.test(f.style ?? '')) ?? faces[0];
  try {
    const blob = await face.blob();
    const off = await collectionOffset(blob, face.postscriptName);
    if (off < 0) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (off > 0) {
      // A font in a collection: its table directory moved to the start makes it a plain font
      // file (table offsets in a collection already count from the start of the file).
      const view = new DataView(bytes.buffer);
      const dirLength = 12 + 16 * view.getUint16(off + 4);
      bytes.copyWithin(0, off, off + dirLength);
    }
    const { default: opentype } = await import('opentype.js');
    return opentype.parse(bytes.buffer);
  } catch {
    return null;
  }
}

/** A glyph's path commands as closed contours, through matrix `m`. */
function glyphContours(commands: PathCommand[], m: DOMMatrix): DocContour[] {
  const out: DocContour[] = [];
  let cur: DocNode[] = [];
  const t = (x: number, y: number): Point => {
    const p = m.transformPoint(new DOMPoint(x, y));
    return { x: p.x, y: p.y };
  };
  const close = () => {
    if (cur.length >= 2) {
      const first = cur[0];
      const last = cur[cur.length - 1];
      // A contour ending where it began: that end node is the first node's incoming side.
      if (Math.hypot(first.anchor.x - last.anchor.x, first.anchor.y - last.anchor.y) < 1e-6) {
        first.in = last.in;
        cur.pop();
      }
      if (cur.length >= 2) out.push({ nodes: cur, closed: true });
    }
    cur = [];
  };
  let px = 0;
  let py = 0;
  for (const c of commands) {
    if (c.type === 'M') {
      close();
      cur.push({ anchor: t(c.x!, c.y!), in: null, out: null });
      [px, py] = [c.x!, c.y!];
    } else if (c.type === 'L') {
      cur.push({ anchor: t(c.x!, c.y!), in: null, out: null });
      [px, py] = [c.x!, c.y!];
    } else if (c.type === 'C') {
      cur[cur.length - 1].out = t(c.x1!, c.y1!);
      cur.push({ anchor: t(c.x!, c.y!), in: t(c.x2!, c.y2!), out: null });
      [px, py] = [c.x!, c.y!];
    } else if (c.type === 'Q') {
      // Quadratic → cubic: controls two thirds of the way to the quadratic control point.
      const q = { x: c.x1!, y: c.y1! };
      cur[cur.length - 1].out = t(px + ((q.x - px) * 2) / 3, py + ((q.y - py) * 2) / 3);
      cur.push({ anchor: t(c.x!, c.y!), in: t(c.x! + ((q.x - c.x!) * 2) / 3, c.y! + ((q.y - c.y!) * 2) / 3), out: null });
      [px, py] = [c.x!, c.y!];
    } else close();
  }
  close();
  return out;
}

/** Outlines from the font file, or null when it lacks a letter. */
async function fromFont(font: Font, o: TextObject, doc: SparcaDocument): Promise<DocContour[] | null> {
  const contours: DocContour[] = [];
  for (const { ch, m } of await placements(doc, o)) {
    const glyph = font.charToGlyph(ch);
    if (!glyph || glyph.index === 0) return null; // drawn with another font by the browser
    contours.push(...glyphContours(glyph.getPath(0, 0, o.fontSize).commands, m));
  }
  const { mergeNonzero } = await loadPathBoolean();
  return mergeNonzero(contours);
}

/** Largest side of the traced image in px. */
const TRACE_MAX_SIDE = 4096;

/** Outlines traced from the text drawn alone at a high resolution. */
async function traced(o: TextObject, doc: SparcaDocument): Promise<DocContour[]> {
  const b = objectBounds(o)!;
  const margin = o.fontSize;
  const x0 = b.x - margin;
  const y0 = b.y - margin;
  const w = b.width + margin * 2;
  const h = b.height + margin * 2;
  // About 256 px per em where it fits.
  const scale = Math.max(0.5, Math.min(256 / o.fontSize, TRACE_MAX_SIDE / Math.max(w, h)));
  const moved: TextObject = { ...o, box: { ...o.box, x: o.box.x - x0, y: o.box.y - y0 } };
  const canvas = await rasterizeDocument(aloneDoc(doc, moved, w, h), { scale, background: null });
  const img = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  const alpha = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
  return traceOutlines(alpha, canvas.width, canvas.height, 128, 0.35, 2).map((loop) => ({
    closed: true,
    nodes: loop.map((p) => ({ anchor: { x: x0 + p.x / scale, y: y0 + p.y / scale }, in: null, out: null })),
  }));
}

/** The text's letters as outlines in document coordinates (empty for blank text). */
export async function outlineText(o: TextObject, doc: SparcaDocument): Promise<TextOutline> {
  const font = await fontFile(o);
  if (font) {
    const exact = await fromFont(font, o, doc);
    if (exact) return { contours: exact, traced: false };
  }
  return { contours: await traced(o, doc), traced: true };
}
