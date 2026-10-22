// Live preview for the selection blur / mosaic dialogs (can be switched off; the choice
// is remembered). The preview is a gesture: 適用 keeps it as one undo step, closing the
// dialog any other way restores the image.
import { useEffect, useRef, useState } from 'react';
import { blurSelection, mosaicSelection, previewSelectionEdit, SELECTION_EDIT_LABELS } from '../store/imageActions';
import { editor } from './useEditor';

const KEY = 'sparca.selectionPreview';

function loadPreference(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function useSelectionPreview(kind: 'blur' | 'mosaic', value: number) {
  const [preview, setPreviewState] = useState(loadPreference);
  const active = useRef(false);

  useEffect(() => {
    if (!preview) {
      if (active.current) editor.cancelGesture();
      active.current = false;
      return;
    }
    // Let a slider settle briefly before reprocessing the image.
    const t = setTimeout(() => {
      active.current = previewSelectionEdit(editor, kind, value);
    }, 80);
    return () => clearTimeout(t);
  }, [preview, kind, value]);

  // Closing without 適用 (キャンセル, Esc, click outside) drops the preview.
  useEffect(
    () => () => {
      if (active.current) editor.cancelGesture();
      active.current = false;
    },
    [],
  );

  const setPreview = (on: boolean) => {
    setPreviewState(on);
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      // Not remembered; still works for this dialog.
    }
  };

  /** Apply with the current value; true when done. */
  const apply = (): boolean => {
    if (preview) {
      // Make sure the preview shows exactly this value, then keep it.
      active.current = previewSelectionEdit(editor, kind, value);
      if (!active.current) return kind === 'blur' ? blurSelection(editor, value) : mosaicSelection(editor, value);
      editor.endGesture(SELECTION_EDIT_LABELS[kind]);
      active.current = false;
      return true;
    }
    return kind === 'blur' ? blurSelection(editor, value) : mosaicSelection(editor, value);
  };

  return { preview, setPreview, apply };
}
