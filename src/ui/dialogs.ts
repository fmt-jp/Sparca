import { useSyncExternalStore } from 'react';
import type { PlacementAnswer, PlacementQuestion } from '../store/actions';

export type DialogState =
  | { kind: 'new' }
  | { kind: 'canvas-size' }
  | { kind: 'image-size'; imageId: string }
  | { kind: 'blur-selection' }
  | { kind: 'mosaic-selection' }
  | { kind: 'grow-selection'; contract: boolean }
  | { kind: 'export' }
  | { kind: 'grid' }
  | { kind: 'image-placement'; question: PlacementQuestion; answer: (a: PlacementAnswer | null) => void }
  | { kind: 'help'; section?: string }
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

/** Ask how to place an image larger than the canvas (resolves null when cancelled). */
export function askImagePlacement(question: PlacementQuestion): Promise<PlacementAnswer | null> {
  return new Promise((resolve) => {
    openDialog({
      kind: 'image-placement',
      question,
      answer: (a) => {
        closeDialog();
        resolve(a);
      },
    });
  });
}
