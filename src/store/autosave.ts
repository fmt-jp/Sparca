// 自動保存 (decided with the user 2026-11-10): every tab with unsaved changes is kept in the
// browser (IndexedDB), 30 seconds after a change, as a .hnb project. Saving the tab to a file
// or closing it removes its copy. When HANABI starts, copies left by a window that is gone
// (closed, crashed) are restored — after asking, or at once (環境設定). A window that is still
// open holds a Web Lock, so another HANABI window never offers its work.
import { readProject, writeProject } from '../io/project';
import { newId } from '../model/factory';
import { assets } from './assets';
import type { EditorStore } from './editor';
import type { SparcaDocument } from '../model/types';

export const AUTOSAVE_DELAY_MS = 30_000;

const DB_NAME = 'hanabi-autosave';
const STORE = 'tabs';
const LOCK_PREFIX = 'hanabi-window-';

/** One tab's work kept by 自動保存. */
export interface AutosaveRecord {
  /** `${windowId}:${tabId}` */
  key: string;
  windowId: string;
  fileName: string;
  /** ms since the epoch */
  savedAt: number;
  data: Blob;
}

/** This window, for the records it writes and the lock it holds while open. */
const windowId = newId('w');

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

const put = (r: AutosaveRecord) => tx('readwrite', (s) => s.put(r));
const remove = (key: string) => tx('readwrite', (s) => s.delete(key));
const all = async () => ((await tx<AutosaveRecord[]>('readonly', (s) => s.getAll())) ?? []);

/** Windows still open (each holds its lock until it goes away). */
async function liveWindows(): Promise<Set<string>> {
  const live = new Set<string>([windowId]);
  if (typeof navigator === 'undefined' || !navigator.locks) return live;
  const q = await navigator.locks.query();
  for (const l of [...(q.held ?? []), ...(q.pending ?? [])]) if (l.name?.startsWith(LOCK_PREFIX)) live.add(l.name.slice(LOCK_PREFIX.length));
  return live;
}

/** Copies left by windows that are gone, newest first. */
export async function leftoverWork(): Promise<AutosaveRecord[]> {
  const live = await liveWindows();
  return (await all()).filter((r) => !live.has(r.windowId)).sort((a, b) => b.savedAt - a.savedAt);
}

/** Open the copies as unsaved tabs, then forget them. Returns how many were restored. */
export async function restoreWork(ed: EditorStore, records: AutosaveRecord[]): Promise<number> {
  let n = 0;
  for (const r of records) {
    try {
      const { doc, assets: blobs } = await readProject(await r.data.arrayBuffer());
      for (const [id, blob] of blobs) assets.put(doc.assets[id], blob);
      ed.openRestored(doc, r.fileName);
      n++;
    } catch (e) {
      ed.notify('error', `「${r.fileName}」の自動保存を復元できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
    await remove(r.key);
  }
  return n;
}

export async function discardWork(records: AutosaveRecord[]): Promise<void> {
  for (const r of records) await remove(r.key);
}

/**
 * Keep this window's unsaved tabs in the browser from now on. Returns `flush` (save every
 * pending tab now; for tests) and `stop`.
 */
export function startAutosave(ed: EditorStore, delayMs = AUTOSAVE_DELAY_MS): { flush: () => Promise<void>; stop: () => void } {
  // Hold this window's lock for as long as it is open.
  let releaseLock: () => void = () => {};
  if (typeof navigator !== 'undefined' && navigator.locks) {
    void navigator.locks.request(LOCK_PREFIX + windowId, () => new Promise<void>((r) => (releaseLock = r)));
  }
  const timers = new Map<string, number>();
  /** The document last written per tab. */
  const written = new Map<string, SparcaDocument>();
  const key = (tab: string) => `${windowId}:${tab}`;

  async function save(tab: string): Promise<void> {
    timers.delete(tab);
    const t = ed.tabDocument(tab);
    if (!t || !t.dirty) return;
    if (written.get(tab) === t.doc) return;
    try {
      const data = await writeProject(t.doc, (id) => assets.get(id)?.blob);
      // The tab may have been saved or closed meanwhile.
      const now = ed.tabDocument(tab);
      if (!now || !now.dirty) return;
      await put({ key: key(tab), windowId, fileName: t.fileName, savedAt: Date.now(), data: new Blob([data as BlobPart]) });
      written.set(tab, t.doc);
    } catch {
      // Storage full or unavailable: nothing to do here (the work is still open in the tab).
    }
  }

  function check(): void {
    const tabs = ed.getState().tabs;
    for (const { id, dirty } of tabs) {
      if (dirty) {
        const t = ed.tabDocument(id);
        if (t && written.get(id) !== t.doc && !timers.has(id)) timers.set(id, window.setTimeout(() => void save(id), delayMs));
      } else if (written.has(id) || timers.has(id)) {
        // Saved to a file: its copy is no longer needed.
        clearTimeout(timers.get(id));
        timers.delete(id);
        written.delete(id);
        void remove(key(id)).catch(() => {});
      }
    }
    // Closed tabs.
    for (const id of [...new Set([...written.keys(), ...timers.keys()])]) {
      if (tabs.some((t) => t.id === id)) continue;
      clearTimeout(timers.get(id));
      timers.delete(id);
      written.delete(id);
      void remove(key(id)).catch(() => {});
    }
  }

  const unsubscribe = ed.subscribe(check);
  check();
  return {
    flush: async () => {
      const pending = [...timers.keys()];
      for (const id of pending) clearTimeout(timers.get(id));
      await Promise.all(pending.map((id) => save(id)));
    },
    stop: () => {
      unsubscribe();
      for (const t of timers.values()) clearTimeout(t);
      releaseLock();
    },
  };
}
