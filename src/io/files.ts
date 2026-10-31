// Browser file access: File System Access API where available, download/input fallback otherwise.

interface FilePickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface FsWindow {
  showSaveFilePicker?: (o: { suggestedName?: string; types?: FilePickerType[] }) => Promise<FileSystemFileHandleLike>;
  showOpenFilePicker?: (o: { types?: FilePickerType[]; multiple?: boolean }) => Promise<FileSystemFileHandleLike[]>;
}

export interface FileSystemFileHandleLike {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}

const fsWindow = (): FsWindow => window as unknown as FsWindow;

export function hasFileSystemAccess(): boolean {
  return typeof fsWindow().showSaveFilePicker === 'function';
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/**
 * Ask where to save (and under what name) before making the file, so a slow export does not
 * outlast the click that allows the dialog. Null without the File System Access API (the
 * file is then downloaded); undefined when the user cancelled.
 */
export async function pickSaveFile(suggestedName: string, type: FilePickerType): Promise<FileSystemFileHandleLike | null | undefined> {
  if (!hasFileSystemAccess()) return null;
  try {
    return await fsWindow().showSaveFilePicker!({ suggestedName, types: [type] });
  } catch (e) {
    if (isAbort(e)) return undefined;
    throw e;
  }
}

/**
 * Save a blob. Returns the chosen handle (or null for the download fallback),
 * or undefined when the user cancelled.
 */
export async function saveBlob(
  blob: Blob,
  suggestedName: string,
  type: FilePickerType,
  existing?: FileSystemFileHandleLike | null,
): Promise<FileSystemFileHandleLike | null | undefined> {
  if (existing || hasFileSystemAccess()) {
    let handle = existing ?? null;
    try {
      handle ??= await fsWindow().showSaveFilePicker!({ suggestedName, types: [type] });
    } catch (e) {
      if (isAbort(e)) return undefined;
      throw e;
    }
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    return handle;
  }
  download(blob, suggestedName);
  return null;
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Show a file chooser and return the selected files (empty when cancelled). */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files ? [...input.files] : []);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}
