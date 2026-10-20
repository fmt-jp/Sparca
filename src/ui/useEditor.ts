import { useSyncExternalStore } from 'react';
import { imageCache } from '../render/imageCache';
import { EditorStore, type EditorState } from '../store/editor';

export const editor = new EditorStore();
imageCache.onError((message) => editor.notify('error', message));

{
  // Exposed for debugging and end-to-end tests.
  const g = globalThis as unknown as { __sparca: EditorStore; __sparcaImages: typeof imageCache };
  g.__sparca = editor;
  g.__sparcaImages = imageCache;
}

export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(editor.subscribe, () => selector(editor.getState()));
}
