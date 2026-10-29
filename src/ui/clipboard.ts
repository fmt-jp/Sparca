// System clipboard integration. Copy/cut/paste go through the browser's clipboard events,
// so images copied elsewhere (e.g. a Windows+Shift+S screenshot) can be pasted onto the
// canvas, while objects copied in HANABI still paste as editable objects.
import { copySelection, cutSelection, isPixelCopy, paste, placeImageFiles, setPixelClipboard } from '../store/actions';
import { canCopyPixels, copySelectionPixels } from '../store/pixelCopy';
import { eraseSelection } from '../store/imageActions';
import { isTextEntry } from './keyboard';
import { editor } from './useEditor';

/**
 * Marks the system clipboard as holding HANABI objects (the objects themselves stay in
 * memory). Whatever is copied later, in any app, replaces it — so on paste we know
 * whether our objects or something newer (an image) is on the clipboard.
 */
export const SPARCA_MIME = 'application/x-sparca-objects';

const IMAGE_NAME = 'クリップボードの画像';

/** Clipboard events that belong to text fields (or open dialogs) keep their usual behavior. */
function forEditor(e: ClipboardEvent): boolean {
  const t = e.target as Element | null;
  return !isTextEntry(t) && !t?.closest?.('[role="dialog"]');
}

function imageFiles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const files = [...dt.files].filter((f) => f.type.startsWith('image/'));
  if (files.length) return files;
  // Some sources only expose the image as a clipboard item.
  return [...dt.items].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter((f): f is File => !!f);
}

/** Give pasted images a readable name (screenshots arrive as "image.png"). */
function named(files: File[]): File[] {
  return files.map((f, i) => new File([f], `${IMAGE_NAME}${files.length > 1 ? ` ${i + 1}` : ''}.${f.type.split('/')[1] || 'png'}`, { type: f.type }));
}

/**
 * Copy the pixels inside the pixel selection: to HANABI's clipboard (pastes back in place)
 * and, where the browser allows, to the system clipboard as a PNG for other apps.
 */
async function copyPixels(cut: boolean): Promise<void> {
  const copying = copySelectionPixels(editor);
  let written: Promise<void> | null = null;
  try {
    // Started right away so it still counts as part of the user's copy; the PNG follows.
    const png = copying.then((c) => c?.png ?? Promise.reject(new Error('nothing copied')));
    written = navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  } catch {
    written = null;
  }
  const copy = await copying;
  await written?.catch(() => undefined); // No clipboard access: HANABI's own clipboard still has it.
  if (!copy) return;
  await setPixelClipboard(copy);
  // カット: the copied pixels are then erased from the image (one undo step).
  if (cut) eraseSelection(editor, '選択範囲をカット');
}

/** Whether pasted image files are HANABI's own latest selection copy (same size). */
async function ownPixelCopy(files: File[]): Promise<boolean> {
  if (files.length !== 1) return false;
  try {
    const bmp = await createImageBitmap(files[0]);
    const own = isPixelCopy(bmp.width, bmp.height);
    bmp.close();
    return own;
  } catch {
    return false;
  }
}

async function pasteImages(files: File[]): Promise<void> {
  if (await ownPixelCopy(files)) paste(editor);
  else await placeImageFiles(editor, named(files));
}

function onCopyOrCut(e: ClipboardEvent, cut: boolean) {
  if (!forEditor(e)) return;
  if (canCopyPixels(editor)) {
    e.preventDefault();
    void copyPixels(cut);
    return;
  }
  if (!editor.getState().selection.length) return;
  e.preventDefault();
  if (cut) cutSelection(editor);
  else copySelection(editor);
  e.clipboardData?.setData(SPARCA_MIME, String(Date.now()));
}

function onPaste(e: ClipboardEvent) {
  if (!forEditor(e)) return;
  e.preventDefault();
  const dt = e.clipboardData;
  if (dt?.types.includes(SPARCA_MIME)) {
    paste(editor);
    return;
  }
  const images = imageFiles(dt);
  if (images.length) void pasteImages(images);
  else paste(editor);
}

export function installClipboardHandlers(): () => void {
  const copy = (e: ClipboardEvent) => onCopyOrCut(e, false);
  const cut = (e: ClipboardEvent) => onCopyOrCut(e, true);
  document.addEventListener('copy', copy);
  document.addEventListener('cut', cut);
  document.addEventListener('paste', onPaste);
  return () => {
    document.removeEventListener('copy', copy);
    document.removeEventListener('cut', cut);
    document.removeEventListener('paste', onPaste);
  };
}

/** Menu コピー／カット: run the browser's copy so the system clipboard is updated too. */
export function menuCopy(cut = false): void {
  let ok = false;
  try {
    ok = document.execCommand(cut ? 'cut' : 'copy');
  } catch {
    ok = false;
  }
  // Without clipboard access, still copy within HANABI.
  if (!ok) {
    if (canCopyPixels(editor)) void copyPixels(cut);
    else if (cut) cutSelection(editor);
    else copySelection(editor);
  }
}

/**
 * Menu ペースト: menus cannot trigger a paste event, so read the clipboard directly
 * (the browser may ask for permission). An image there is placed; otherwise — including
 * HANABI's own copies, which the browser does not list — the copied objects are pasted.
 */
export async function menuPaste(): Promise<void> {
  try {
    const items = await navigator.clipboard.read();
    const files: File[] = [];
    for (const item of items) {
      if (item.types.includes(SPARCA_MIME) || item.types.includes(`web ${SPARCA_MIME}`)) {
        paste(editor);
        return;
      }
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) files.push(new File([await item.getType(type)], 'image', { type }));
    }
    if (files.length) {
      await pasteImages(files);
      return;
    }
  } catch {
    // No permission or nothing readable: fall back to HANABI's own clipboard.
  }
  paste(editor);
}
