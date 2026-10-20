import { describe, expect, it } from 'vitest';
import { emptyHistory, record, redo, undo, MERGE_WINDOW_MS } from './history';

describe('history', () => {
  it('undoes and redoes in order', () => {
    let h = emptyHistory<number>();
    let cur = 0;
    h = record(h, cur, 'a'); cur = 1;
    h = record(h, cur, 'b'); cur = 2;
    let r = undo(h, cur)!; h = r.history; cur = r.state;
    expect(cur).toBe(1);
    r = undo(h, cur)!; h = r.history; cur = r.state;
    expect(cur).toBe(0);
    expect(undo(h, cur)).toBeNull();
    r = redo(h, cur)!; h = r.history; cur = r.state;
    expect(cur).toBe(1);
    r = redo(h, cur)!; h = r.history; cur = r.state;
    expect(cur).toBe(2);
    expect(redo(h, cur)).toBeNull();
  });

  it('clears redo stack on new edit', () => {
    let h = emptyHistory<number>();
    h = record(h, 0, 'a');
    const r = undo(h, 1)!;
    h = record(r.history, r.state, 'b');
    expect(h.future).toHaveLength(0);
  });

  it('merges consecutive edits with the same key within the window', () => {
    let h = emptyHistory<number>();
    h = record(h, 0, 'opacity', 'k', 1000);
    h = record(h, 1, 'opacity', 'k', 1500);
    h = record(h, 2, 'opacity', 'k', 2000);
    expect(h.past).toHaveLength(1);
    expect(undo(h, 3)!.state).toBe(0);
    h = record(h, 3, 'opacity', 'k', 2000 + MERGE_WINDOW_MS + 1);
    expect(h.past).toHaveLength(2);
  });
});
