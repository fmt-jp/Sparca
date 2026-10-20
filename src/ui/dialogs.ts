import { useSyncExternalStore } from 'react';

export type DialogState =
  | { kind: 'new' }
  | { kind: 'canvas-size' }
  | { kind: 'image-size'; imageId: string }
  | { kind: 'blur-selection' }
  | null;

let current: DialogState = null;
const listeners = new Set<() => void>();

export function openDialog(d: DialogState): void {
  current = d;
  listeners.forEach((l) => l());
}

export function closeDialog(): void {
  openDialog(null);
}

export function useDialog(): DialogState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
