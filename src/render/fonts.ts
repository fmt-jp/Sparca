// Fonts installed on this PC: a curated list checked for availability, plus — where the
// browser offers the Local Font Access API (Chrome / Edge) and the user allows it — every
// installed family. Text keeps only the family name; rendering adds a generic fallback.

export const GENERIC_FAMILIES = ['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy'];

export type FontGroup = 'ja' | 'latin' | 'generic' | 'local';

export interface FontEntry {
  family: string;
  /** Display name (Japanese name for well-known Japanese fonts). */
  label: string;
  group: FontGroup;
}

/** Well-known fonts on Windows, macOS and Linux. Only the ones found on this PC are listed. */
const CANDIDATES: { family: string; label?: string; group: 'ja' | 'latin' }[] = [
  // Japanese — Windows
  { family: 'Yu Gothic', label: '游ゴシック', group: 'ja' },
  { family: 'Yu Mincho', label: '游明朝', group: 'ja' },
  { family: 'Meiryo', label: 'メイリオ', group: 'ja' },
  { family: 'MS Gothic', label: 'ＭＳ ゴシック', group: 'ja' },
  { family: 'MS PGothic', label: 'ＭＳ Ｐゴシック', group: 'ja' },
  { family: 'MS Mincho', label: 'ＭＳ 明朝', group: 'ja' },
  { family: 'MS PMincho', label: 'ＭＳ Ｐ明朝', group: 'ja' },
  { family: 'BIZ UDPGothic', label: 'BIZ UDPゴシック', group: 'ja' },
  { family: 'BIZ UDPMincho', label: 'BIZ UDP明朝', group: 'ja' },
  { family: 'UD Digi Kyokasho NK-R', label: 'UD デジタル 教科書体 NK-R', group: 'ja' },
  { family: 'HGGothicE', label: 'HGゴシックE', group: 'ja' },
  { family: 'HGMaruGothicMPRO', label: 'HG丸ゴシックM-PRO', group: 'ja' },
  { family: 'HGSoeiKakupoptai', label: 'HG創英角ポップ体', group: 'ja' },
  { family: 'HGMinchoE', label: 'HG明朝E', group: 'ja' },
  { family: 'HGSeikaishotaiPRO', label: 'HG正楷書体-PRO', group: 'ja' },
  // Japanese — macOS
  { family: 'Hiragino Sans', label: 'ヒラギノ角ゴシック', group: 'ja' },
  { family: 'Hiragino Kaku Gothic ProN', label: 'ヒラギノ角ゴ ProN', group: 'ja' },
  { family: 'Hiragino Maru Gothic ProN', label: 'ヒラギノ丸ゴ ProN', group: 'ja' },
  { family: 'Hiragino Mincho ProN', label: 'ヒラギノ明朝 ProN', group: 'ja' },
  { family: 'Osaka', label: 'Osaka', group: 'ja' },
  { family: 'Klee', label: 'クレー', group: 'ja' },
  { family: 'Tsukushi A Round Gothic', label: '筑紫A丸ゴシック', group: 'ja' },
  { family: 'Toppan Bunkyu Gothic', label: '凸版文久ゴシック', group: 'ja' },
  { family: 'Toppan Bunkyu Mincho', label: '凸版文久明朝', group: 'ja' },
  // Japanese — Linux / free
  { family: 'Noto Sans CJK JP', group: 'ja' },
  { family: 'Noto Serif CJK JP', group: 'ja' },
  { family: 'Noto Sans JP', group: 'ja' },
  { family: 'Noto Serif JP', group: 'ja' },
  { family: 'IPAexGothic', label: 'IPAexゴシック', group: 'ja' },
  { family: 'IPAexMincho', label: 'IPAex明朝', group: 'ja' },
  { family: 'M PLUS Rounded 1c', group: 'ja' },
  // Latin
  { family: 'Arial', group: 'latin' },
  { family: 'Arial Black', group: 'latin' },
  { family: 'Helvetica', group: 'latin' },
  { family: 'Helvetica Neue', group: 'latin' },
  { family: 'Segoe UI', group: 'latin' },
  { family: 'Calibri', group: 'latin' },
  { family: 'Candara', group: 'latin' },
  { family: 'Corbel', group: 'latin' },
  { family: 'Tahoma', group: 'latin' },
  { family: 'Trebuchet MS', group: 'latin' },
  { family: 'Verdana', group: 'latin' },
  { family: 'Avenir', group: 'latin' },
  { family: 'Avenir Next', group: 'latin' },
  { family: 'Futura', group: 'latin' },
  { family: 'Gill Sans', group: 'latin' },
  { family: 'Optima', group: 'latin' },
  { family: 'Times New Roman', group: 'latin' },
  { family: 'Georgia', group: 'latin' },
  { family: 'Cambria', group: 'latin' },
  { family: 'Constantia', group: 'latin' },
  { family: 'Palatino Linotype', group: 'latin' },
  { family: 'Palatino', group: 'latin' },
  { family: 'Baskerville', group: 'latin' },
  { family: 'Didot', group: 'latin' },
  { family: 'Garamond', group: 'latin' },
  { family: 'Courier New', group: 'latin' },
  { family: 'Consolas', group: 'latin' },
  { family: 'Menlo', group: 'latin' },
  { family: 'Monaco', group: 'latin' },
  { family: 'Impact', group: 'latin' },
  { family: 'Comic Sans MS', group: 'latin' },
  { family: 'Segoe Print', group: 'latin' },
  { family: 'Segoe Script', group: 'latin' },
  { family: 'Brush Script MT', group: 'latin' },
  { family: 'Chalkboard', group: 'latin' },
  { family: 'Marker Felt', group: 'latin' },
  { family: 'DejaVu Sans', group: 'latin' },
  { family: 'DejaVu Serif', group: 'latin' },
  { family: 'DejaVu Sans Mono', group: 'latin' },
  { family: 'Liberation Sans', group: 'latin' },
  { family: 'Liberation Serif', group: 'latin' },
  { family: 'Liberation Mono', group: 'latin' },
];

const GENERIC_LABELS: Record<string, string> = {
  'sans-serif': 'ゴシック体（標準）',
  serif: '明朝体（標準）',
  monospace: '等幅（標準）',
  cursive: '筆記体（標準）',
  fantasy: '装飾体（標準）',
};

/** CSS font-family value for a stored family name: quoted, with a generic fallback. */
export function cssFontFamily(family: string): string {
  if (GENERIC_FAMILIES.includes(family)) return family;
  return `"${family.replace(/["\\]/g, '')}", sans-serif`;
}

export function fontLabel(family: string): string {
  return GENERIC_LABELS[family] ?? CANDIDATES.find((c) => c.family === family)?.label ?? localFontLabel(family) ?? family;
}

let measure: CanvasRenderingContext2D | null | undefined;
const SAMPLE = 'mmmmmmmmmmlliWW永あア漢字';
const availability = new Map<string, boolean>();

/**
 * Whether `family` is installed: text set in it must measure differently from at least
 * one of the generic fonts it would otherwise fall back to.
 */
export function isFontAvailable(family: string): boolean {
  if (GENERIC_FAMILIES.includes(family)) return true;
  const hit = availability.get(family);
  if (hit !== undefined) return hit;
  if (measure === undefined) measure = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!measure) return true;
  const quoted = `"${family.replace(/["\\]/g, '')}"`;
  let found = false;
  for (const base of ['monospace', 'serif', 'sans-serif']) {
    measure.font = `72px ${base}`;
    const w0 = measure.measureText(SAMPLE).width;
    measure.font = `72px ${quoted}, ${base}`;
    if (Math.abs(measure.measureText(SAMPLE).width - w0) > 0.5) {
      found = true;
      break;
    }
  }
  availability.set(family, found);
  return found;
}

/** Curated fonts found on this PC, plus the generic families. */
export function detectedFonts(): FontEntry[] {
  const found: FontEntry[] = CANDIDATES.filter((c) => isFontAvailable(c.family)).map((c) => ({
    family: c.family,
    label: c.label ?? c.family,
    group: c.group,
  }));
  return [...found, ...GENERIC_FAMILIES.map((f) => ({ family: f, label: GENERIC_LABELS[f], group: 'generic' as const }))];
}

type LocalFontData = { family: string; postscriptName?: string; style?: string; blob?: () => Promise<Blob> };
type FontWindow = Window & { queryLocalFonts?: () => Promise<LocalFontData[]> };

export function canListLocalFonts(): boolean {
  return typeof window !== 'undefined' && typeof (window as FontWindow).queryLocalFonts === 'function';
}

export interface LocalFont {
  family: string;
  /** Japanese name from the font file when it has one (Chrome only reports English names). */
  label: string;
}

let localFonts: LocalFont[] | null = null;
/** One font per family to read the Japanese name from (the regular style if present). */
const sample = new Map<string, LocalFontData>();
const LABELS_KEY = 'sparca.fontLabels';

function loadLabelCache(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LABELS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

const byLabel = (a: LocalFont, b: LocalFont) => a.label.localeCompare(b.label, 'ja');

/** Every installed family via the Local Font Access API (asks for permission the first time). */
export async function listLocalFonts(): Promise<LocalFont[]> {
  if (localFonts) return localFonts;
  const fonts = await (window as FontWindow).queryLocalFonts!();
  for (const f of fonts) {
    const cur = sample.get(f.family);
    if (!cur || (f.style === 'Regular' && cur.style !== 'Regular')) sample.set(f.family, f);
  }
  const cache = loadLabelCache();
  localFonts = [...sample.keys()].map((family) => ({ family, label: cache[family] ?? family })).sort(byLabel);
  return localFonts;
}

let localizing: Promise<LocalFont[]> | null = null;

/**
 * Read the Japanese names of the listed fonts from their files (only the name table is
 * read) and remember them. Resolves with the updated, re-sorted list.
 */
export function localizeLocalFonts(): Promise<LocalFont[]> {
  if (!localFonts) return Promise.resolve([]);
  localizing ??= (async () => {
    const { japaneseFamilyName } = await import('./fontNames');
    const cache = loadLabelCache();
    for (const f of localFonts!) {
      if (f.family in cache) continue;
      const data = sample.get(f.family);
      let name: string | null = null;
      try {
        if (data?.blob) name = await japaneseFamilyName(await data.blob(), data.postscriptName);
      } catch {
        name = null;
      }
      // Remember "no Japanese name" too, so files are read only once.
      cache[f.family] = name && name !== f.family ? name : f.family;
    }
    try {
      localStorage.setItem(LABELS_KEY, JSON.stringify(cache));
    } catch {
      // Not cached; names are read again next time.
    }
    localFonts = localFonts!.map((f) => ({ ...f, label: cache[f.family] ?? f.family })).sort(byLabel);
    return localFonts;
  })();
  return localizing;
}

/** Display name of a family: a curated / generic label, else a Japanese name read from the PC. */
export function localFontLabel(family: string): string | null {
  return localFonts?.find((f) => f.family === family)?.label ?? null;
}

/** Fonts listed earlier in this session, or after permission was granted before. */
export async function localFontsIfAllowed(): Promise<LocalFont[] | null> {
  if (localFonts) return localFonts;
  if (!canListLocalFonts() || !navigator.permissions) return null;
  try {
    const st = await navigator.permissions.query({ name: 'local-fonts' as PermissionName });
    return st.state === 'granted' ? await listLocalFonts() : null;
  } catch {
    return null;
  }
}
