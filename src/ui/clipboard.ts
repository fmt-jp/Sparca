// System clipboard integration. Copy/cut/paste go through the browser's clipboard events,
// so images copied elsewhere (e.g. a Windows+Shift+S screenshot) can be pasted onto the
// canvas, while objects copied in Sparca still paste as editable objects.
import { copySelection, cutSelection, paste, placeImageFiles } from '../store/actions';
import { isTextEntry } from './keyboard';
import { editor } from './useEditor';

/**
 * Marks the system clipboard as holding Sparca objects (the objects themselves stay in
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

function onCopyOrCut(e: ClipboardEvent, cut: boolean) {
  if (!forEditor(e) || !editor.getState().selection.length) return;
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
  if (images.length) void placeImageFiles(editor, named(images));
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
  // Without clipboard access, still copy within Sparca.
  if (!ok) {
    if (cut) cutSelection(editor);
    else copySelection(editor);
  }
}

/**
 * Menu ペースト: menus cannot trigger a paste event, so read the clipboard directly
 * (the browser may ask for permission). An image there is placed; otherwise — including
 * Sparca's own copies, which the browser does not list — the copied objects are pasted.
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
      await placeImageFiles(editor, named(files));
      return;
    }
  } catch {
    // No permission or nothing readable: fall back to Sparca's own clipboard.
  }
  paste(editor);
}
