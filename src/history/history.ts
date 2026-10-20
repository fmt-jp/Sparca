// Snapshot undo/redo history. Documents are immutable and structurally shared,
// so each entry only holds a reference to a previous document (docs/design.md §5).

export interface HistoryEntry<T> {
  state: T;
  label: string;
  /** Consecutive commits with the same key are merged into one entry. */
  mergeKey: string | null;
  time: number;
}

export interface HistoryState<T> {
  past: HistoryEntry<T>[];
  future: HistoryEntry<T>[];
}

export const HISTORY_LIMIT = 200;
/** Same-key edits closer together than this merge into one undo step. */
export const MERGE_WINDOW_MS = 1500;

export function emptyHistory<T>(): HistoryState<T> {
  return { past: [], future: [] };
}

/**
 * Record that `previous` was replaced by a new state.
 * Returns the new history; the caller holds the new current state.
 */
export function record<T>(
  h: HistoryState<T>,
  previous: T,
  label: string,
  mergeKey: string | null = null,
  now = Date.now(),
): HistoryState<T> {
  const last = h.past[h.past.length - 1];
  if (mergeKey && last && last.mergeKey === mergeKey && now - last.time < MERGE_WINDOW_MS && h.future.length === 0) {
    // Keep the older snapshot so one undo reverts the whole run of edits.
    const merged = { ...last, time: now };
    return { past: [...h.past.slice(0, -1), merged], future: [] };
  }
  const past = [...h.past, { state: previous, label, mergeKey, time: now }];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, future: [] };
}

export function undo<T>(h: HistoryState<T>, current: T): { history: HistoryState<T>; state: T; label: string } | null {
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  return {
    history: {
      past: h.past.slice(0, -1),
      future: [{ ...entry, state: current }, ...h.future],
    },
    state: entry.state,
    label: entry.label,
  };
}

export function redo<T>(h: HistoryState<T>, current: T): { history: HistoryState<T>; state: T; label: string } | null {
  const entry = h.future[0];
  if (!entry) return null;
  return {
    history: {
      past: [...h.past, { ...entry, state: current, mergeKey: null }],
      future: h.future.slice(1),
    },
    state: entry.state,
    label: entry.label,
  };
}
