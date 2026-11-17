import { describe, expect, it } from 'vitest';
import { addToList, type RecentEntry } from './recentFiles';
import type { FileSystemFileHandleLike } from '../io/files';

/** A stand-in handle: the same file when the path matches. */
const handle = (path: string) =>
  ({ name: path.split('/').pop()!, path, isSameEntry: async (o: { path?: string }) => o.path === path }) as unknown as FileSystemFileHandleLike;
const entry = (id: string, path: string, time = 0): RecentEntry => ({ id, name: path, time, handle: handle(path) });

describe('最近使ったファイル', () => {
  it('puts the file on top, replacing its older entry, and keeps the newest `limit`', async () => {
    const list = [entry('a', 'x/a.hnb'), entry('b', 'x/b.hnb'), entry('c', 'x/c.hnb')];
    let r = await addToList(list, entry('b2', 'x/b.hnb'), 10);
    expect(r.list.map((e) => e.id)).toEqual(['b2', 'a', 'c']);
    expect(r.dropped).toEqual(['b']);
    r = await addToList(list, entry('d', 'x/d.hnb'), 2);
    expect(r.list.map((e) => e.id)).toEqual(['d', 'a']);
    expect(r.dropped.sort()).toEqual(['b', 'c']);
    // A file with the same name in another folder is another file.
    r = await addToList(list, entry('a2', 'y/a.hnb'), 10);
    expect(r.list.map((e) => e.id)).toEqual(['a2', 'a', 'b', 'c']);
  });
});
