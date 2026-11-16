// ライブラリ (2026-11-16): the items kept in this browser (localStorage, like the other
// per-browser settings), and applying / registering / importing / exporting them.
import {
  applyItem,
  itemFromObject,
  libraryFile,
  partsOf,
  uniqueName,
  type LibraryItem,
  type LibraryPart,
} from '../model/library';
import { newId } from '../model/factory';
import { findObject, isEffectivelyLocked } from '../model/tree';
import { validateLibrary } from '../io/validate';
import type { EditorStore } from './editor';

const KEY = 'sparca.library';

function load(): LibraryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const r = validateLibrary(JSON.parse(raw));
    return r.ok ? r.items : [];
  } catch {
    return [];
  }
}

let items: LibraryItem[] = load();
const listeners = new Set<() => void>();

function commit(next: LibraryItem[]): boolean {
  items = next;
  listeners.forEach((l) => l());
  try {
    localStorage.setItem(KEY, JSON.stringify(libraryFile(next)));
    return true;
  } catch {
    return false;
  }
}

export function libraryItems(): LibraryItem[] {
  return items;
}

export function subscribeLibrary(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** For tests: start over with these items. */
export function resetLibrary(next: LibraryItem[] = []): void {
  commit(next);
}

function save(ed: EditorStore, next: LibraryItem[]): void {
  if (!commit(next)) ed.notify('error', 'ライブラリをこのブラウザに保存できませんでした（容量の不足など）。エクスポートして残してください。');
}

/** The selected objects that can be changed (not locked). */
function targets(ed: EditorStore) {
  const { doc, selection } = ed.getState();
  return selection.map((id) => findObject(doc, id)).filter((l) => l && !isEffectivelyLocked(l)).map((l) => l!.object);
}

/** The one selected object an item can be registered from, and what it can give. */
export function registerSource(ed: EditorStore) {
  const sel = ed.getState().selection;
  if (sel.length !== 1) return null;
  const loc = findObject(ed.getState().doc, sel[0]);
  if (!loc) return null;
  const parts = partsOf(loc.object);
  return parts.length ? { object: loc.object, parts } : null;
}

export function registerItem(ed: EditorStore, name: string, parts: LibraryPart[]): LibraryItem | null {
  const src = registerSource(ed);
  if (!src) return null;
  const item = itemFromObject(src.object, uniqueName(name.trim(), items.map((i) => i.name)), parts);
  save(ed, [...items, item]);
  return item;
}

export function applyLibraryItem(ed: EditorStore, item: LibraryItem, append = false): boolean {
  const objs = targets(ed);
  if (!objs.length) {
    ed.notify('error', 'ライブラリを適用するオブジェクトを選択してください。');
    return false;
  }
  applyTo(ed, objs.map((o) => o.id), item, append);
  return true;
}

/** Apply to the given objects (drag and drop onto the canvas). */
export function applyTo(ed: EditorStore, ids: string[], item: LibraryItem, append = false): void {
  ed.edit(`「${item.name}」の適用`, (d) => {
    for (const id of ids) {
      const loc = findObject(d, id);
      if (loc && !isEffectivelyLocked(loc)) applyItem(loc.object, item, append);
    }
  });
}

export function updateItem(ed: EditorStore, id: string, patch: (i: LibraryItem) => LibraryItem): void {
  save(ed, items.map((i) => (i.id === id ? patch(i) : i)));
}

export function renameItem(ed: EditorStore, id: string, name: string): void {
  const n = name.trim();
  if (!n) return;
  updateItem(ed, id, (i) => ({ ...i, name: uniqueName(n, items.filter((x) => x.id !== id).map((x) => x.name)) }));
}

export function duplicateItem(ed: EditorStore, id: string): void {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return;
  const copy = { ...structuredClone(items[i]), id: newId('lib'), name: uniqueName(items[i].name, items.map((x) => x.name)) };
  save(ed, [...items.slice(0, i + 1), copy, ...items.slice(i + 1)]);
}

export function removeItem(ed: EditorStore, id: string): void {
  save(ed, items.filter((i) => i.id !== id));
}

export function moveItem(ed: EditorStore, id: string, before: string | null): void {
  const it = items.find((i) => i.id === id);
  if (!it || id === before) return;
  const rest = items.filter((i) => i.id !== id);
  const at = before ? rest.findIndex((i) => i.id === before) : rest.length;
  save(ed, [...rest.slice(0, at < 0 ? rest.length : at), it, ...rest.slice(at < 0 ? rest.length : at)]);
}

export type ImportChoice = 'rename' | 'replace' | 'skip';

/**
 * Add imported items: a new name is added as is; a name already here is added under another
 * name (rename), replaces the one here (replace), or is left out (skip).
 */
export function importItems(ed: EditorStore, incoming: LibraryItem[], choice: (item: LibraryItem) => ImportChoice): number {
  let next = [...items];
  let added = 0;
  for (const raw of incoming) {
    const item = { ...structuredClone(raw), id: newId('lib') };
    const same = next.findIndex((i) => i.name === item.name);
    if (same < 0) {
      next.push(item);
      added++;
      continue;
    }
    const c = choice(raw);
    if (c === 'skip') continue;
    if (c === 'replace') next[same] = { ...item, id: next[same].id };
    else next.push({ ...item, name: uniqueName(item.name, next.map((i) => i.name)) });
    added++;
  }
  save(ed, next);
  return added;
}
