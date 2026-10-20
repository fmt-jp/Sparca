import { useSyncExternalStore } from 'react';
import { EditorStore, type EditorState } from '../store/editor';

export const editor = new EditorStore();

{
  // Exposed for debugging and end-to-end tests.
  (globalThis as unknown as { __sparca: EditorStore }).__sparca = editor;
}

export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(editor.subscribe, () => selector(editor.getState()));
}
