// 最近使ったファイル (2026-11-17, decided with the user): the files saved or opened in this
// browser, newest first, as many as 環境設定 says. Only where the browser can hand out file
// handles (File System Access API: Chrome, Edge): the handles are kept in IndexedDB, and opening
// one reads the file as it is now (asking the browser's permission again when needed).
import type { FileSystemFileHandleLike } from '../io/files';

export interface RecentEntry {
  id: string;
  name: string;
  /** When it was last saved or opened (ms). */
  time: number;
  handle: FileSystemFileHandleLike;
}

export const RECENT_LIMIT = { min: 0, max: 30, initial: 10 };

const DB = 'hanabi-recent';
const STORE = 'files';

interface HandleWithSame extends FileSystemFileHandleLike {
  isSameEntry?: (other: FileSystemFileHandleLike) => Promise<boolean>;
  queryPermission?: (o: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

let entries: RecentEntry[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function recentEntries(): RecentEntry[] {
  return entries;
}

export function subscribeRecent(l: () => void): () => void {
  listeners.add(l);
  if (!loaded) void loadRecent();
  return () => listeners.delete(l);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadRecent(): Promise<RecentEntry[]> {
  loaded = true;
  try {
    const all = ((await withStore<RecentEntry[]>('readonly', (s) => s.getAll() as IDBRequest<RecentEntry[]>)) ?? []).sort((a, b) => b.time - a.time);
    entries = all;
  } catch {
    entries = [];
  }
  emit();
  return entries;
}

/**
 * The list with `entry` at the top (an entry for the same file — same handle, or failing that
 * the same name — is replaced), cut to `limit`. Returns the new list and the ids dropped.
 */
export async function addToList(list: RecentEntry[], entry: RecentEntry, limit: number): Promise<{ list: RecentEntry[]; dropped: string[] }> {
  const rest: RecentEntry[] = [];
  const dropped: string[] = [];
  for (const e of list) {
    if (await sameFile(e.handle, entry.handle)) dropped.push(e.id);
    else rest.push(e);
  }
  const next = [entry, ...rest];
  const keep = next.slice(0, Math.max(0, limit));
  for (const e of next.slice(keep.length)) dropped.push(e.id);
  return { list: keep, dropped };
}

async function sameFile(a: FileSystemFileHandleLike, b: FileSystemFileHandleLike): Promise<boolean> {
  const h = a as HandleWithSame;
  if (typeof h.isSameEntry === 'function') {
    try {
      return await h.isSameEntry(b);
    } catch {
      // fall through
    }
  }
  return a === b;
}

/** Remember a file just saved or opened (nothing when the limit is 0 or there is no handle). */
export async function recordRecent(handle: FileSystemFileHandleLike | null | undefined, limit: number): Promise<void> {
  if (!handle || limit <= 0) return;
  try {
    if (!loaded) await loadRecent();
    const entry: RecentEntry = { id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, name: handle.name, time: Date.now(), handle };
    const { list, dropped } = await addToList(entries, entry, limit);
    await withStore('readwrite', (s) => {
      for (const id of dropped) s.delete(id);
      s.put(entry);
    });
    entries = list;
    emit();
  } catch {
    // Not remembered (e.g. storage blocked): saving and opening still work.
  }
}

/** Keep only the newest `limit` (after 環境設定 lowers it). */
export async function trimRecent(limit: number): Promise<void> {
  if (!loaded) await loadRecent();
  if (entries.length <= limit) return;
  const drop = entries.slice(Math.max(0, limit));
  try {
    await withStore('readwrite', (s) => {
      for (const e of drop) s.delete(e.id);
    });
  } catch {
    // ignore
  }
  entries = entries.slice(0, Math.max(0, limit));
  emit();
}

export async function removeRecent(id: string): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(id));
  } catch {
    // ignore
  }
  entries = entries.filter((e) => e.id !== id);
  emit();
}

export async function clearRecent(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.clear());
  } catch {
    // ignore
  }
  entries = [];
  emit();
}

/**
 * Permission to read the file again (the browser may ask; must run from a click). Returns
 * false when the user says no.
 */
export async function ensureReadable(handle: FileSystemFileHandleLike): Promise<boolean> {
  const h = handle as HandleWithSame;
  if (typeof h.queryPermission !== 'function') return true;
  if ((await h.queryPermission({ mode: 'read' })) === 'granted') return true;
  if (typeof h.requestPermission !== 'function') return false;
  return (await h.requestPermission({ mode: 'read' })) === 'granted';
}
