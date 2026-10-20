// Raster formats Sparca can open or place, identified by their leading bytes
// (file extensions and browser-reported MIME types are unreliable, e.g. .dib/.rle/.jpe).

export interface ImageFormat {
  label: string;
  mime: string;
  extensions: string[];
}

export const IMAGE_FORMATS: ImageFormat[] = [
  { label: 'PNG', mime: 'image/png', extensions: ['.png'] },
  { label: 'JPEG', mime: 'image/jpeg', extensions: ['.jpg', '.jpe', '.jpeg'] },
  { label: 'GIF', mime: 'image/gif', extensions: ['.gif'] },
  { label: 'BMP', mime: 'image/bmp', extensions: ['.bmp', '.dib', '.rle'] },
  // Already supported for placing images before; kept so existing workflows keep working.
  { label: 'WebP', mime: 'image/webp', extensions: ['.webp'] },
];

export const SUPPORTED_LABEL = 'PNG / JPEG / GIF / BMP';

/** `accept` attribute for file choosers. */
export const IMAGE_ACCEPT = IMAGE_FORMATS.flatMap((f) => [f.mime, ...f.extensions]).join(',');

const ascii = (b: Uint8Array, start: number, text: string) =>
  [...text].every((c, i) => b[start + i] === c.charCodeAt(0));

/** Detect the image format from the first bytes of a file, or null if unsupported. */
export function sniffImageFormat(b: Uint8Array): ImageFormat | null {
  const by = (mime: string) => IMAGE_FORMATS.find((f) => f.mime === mime)!;
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 'PNG\r\n\x1a\n')) return by('image/png');
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return by('image/jpeg');
  if (b.length >= 6 && (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a'))) return by('image/gif');
  if (b.length >= 14 && ascii(b, 0, 'BM')) return by('image/bmp');
  if (b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return by('image/webp');
  return null;
}

/** Whether a file name has one of the supported image extensions. */
export function hasImageExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_FORMATS.some((f) => f.extensions.some((e) => lower.endsWith(e)));
}

/** File name without its image extension (for naming a document opened from an image). */
export function stripImageExtension(name: string): string {
  const lower = name.toLowerCase();
  for (const f of IMAGE_FORMATS) for (const e of f.extensions) if (lower.endsWith(e)) return name.slice(0, -e.length);
  return name;
}
