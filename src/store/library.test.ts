import { beforeAll, describe, expect, it } from 'vitest';
import type { LibraryItem } from '../model/library';
import type { EditorStore } from './editor';

// The library lives in localStorage; give the node test environment a memory one.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
} as Storage;

let lib: typeof import('./library');
beforeAll(async () => {
  lib = await import('./library');
});

const notices: string[] = [];
const ed = { notify: (_k: string, m: string) => notices.push(m) } as unknown as EditorStore;
const item = (name: string, color = '#000000'): LibraryItem => ({ id: name, name, fill: color });

describe('library store', () => {
  it('imports: new names are added; a name already there is renamed, replaces or is skipped', () => {
    lib.resetLibrary([item('影'), item('光彩'), item('枠')]);
    const n = lib.importItems(ed, [item('影', '#111111'), item('光彩', '#222222'), item('枠', '#333333'), item('新しい')], (i) =>
      i.name === '影' ? 'rename' : i.name === '光彩' ? 'replace' : 'skip',
    );
    expect(n).toBe(3);
    const names = lib.libraryItems().map((i) => [i.name, i.fill]);
    expect(names).toEqual([
      ['影', '#000000'],
      ['光彩', '#222222'],
      ['枠', '#000000'],
      ['影 2', '#111111'],
      ['新しい', '#000000'],
    ]);
    // Kept in this browser as a library file.
    expect(JSON.parse(mem.get('sparca.library')!)).toMatchObject({ format: 'hanabi-library', version: 1 });
    expect(notices).toEqual([]);
  });

  it('rename keeps names unique; duplicate goes next to it; move reorders; remove', () => {
    lib.resetLibrary([item('a'), item('b')]);
    lib.renameItem(ed, 'b', 'a');
    expect(lib.libraryItems().map((i) => i.name)).toEqual(['a', 'a 2']);
    lib.duplicateItem(ed, 'a');
    expect(lib.libraryItems().map((i) => i.name)).toEqual(['a', 'a 3', 'a 2']);
    lib.moveItem(ed, 'b', 'a');
    expect(lib.libraryItems()[0].name).toBe('a 2');
    lib.removeItem(ed, 'a');
    expect(lib.libraryItems().map((i) => i.name)).toEqual(['a 2', 'a 3']);
  });
});
