import { useEffect } from 'react';
import {
  arrangeSelection,
  chooseAndOpenProject,
  chooseAndPlaceImage,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  nudgeSelection,
  paste,
  saveProject,
  selectAll,
  ungroupSelection,
} from '../store/actions';
import type { ToolId } from '../store/editor';
import { CanvasSizeDialog } from './CanvasSizeDialog';
import { CanvasView } from './CanvasView';
import { BlurSelectionDialog } from './BlurSelectionDialog';
import { closeDialog, openDialog, useDialog } from './dialogs';
import { ImageSizeDialog } from './ImageSizeDialog';
import { LayersPanel } from './LayersPanel';
import { MenuBar, zoomIn, zoomOut, zoomToFit } from './MenuBar';
import { NewDocumentDialog } from './NewDocumentDialog';
import { PropertiesPanel } from './PropertiesPanel';
import { Toolbar } from './Toolbar';
import { TOOL_GROUPS } from './tools';
import { editor, useEditor } from './useEditor';

export function App() {
  const dialog = useDialog();
  const notices = useEditor((s) => s.notices);
  const busy = useEditor((s) => s.busy);
  const fileName = useEditor((s) => s.fileName);
  const dirty = useEditor((s) => s.doc !== s.savedDoc);

  useEffect(() => {
    document.title = `${dirty ? '● ' : ''}${fileName} — Sparca`;
  }, [dirty, fileName]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (editor.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
      if (handleShortcut(e, () => openDialog({ kind: 'new' }))) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  return (
    <div className="app">
      <MenuBar onNew={() => openDialog({ kind: 'new' })} />
      <Toolbar />
      <CanvasView />
      <LayersPanel />
      <PropertiesPanel />
      {dialog?.kind === 'new' && <NewDocumentDialog onClose={closeDialog} />}
      {dialog?.kind === 'canvas-size' && <CanvasSizeDialog onClose={closeDialog} />}
      {dialog?.kind === 'image-size' && <ImageSizeDialog imageId={dialog.imageId} onClose={closeDialog} />}
      {dialog?.kind === 'blur-selection' && <BlurSelectionDialog onClose={closeDialog} />}
      <div className="notices" role="status" aria-live="polite">
        {notices.map((n) => (
          <div key={n.id} className={`notice ${n.kind}`} onClick={() => editor.dismiss(n.id)}>
            {n.message}
          </div>
        ))}
      </div>
      {busy && (
        <div className="busy" role="progressbar" aria-label={busy}>
          <div className="spinner" />
          {busy}
        </div>
      )}
    </div>
  );
}

function handleShortcut(e: KeyboardEvent, openNew: () => void): boolean {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod) {
    if (k === 'z' && !e.shiftKey) editor.undo();
    else if ((k === 'z' && e.shiftKey) || k === 'y') editor.redo();
    else if (k === 's') void saveProject(editor, e.shiftKey);
    else if (k === 'o') void chooseAndOpenProject(editor);
    else if (k === 'n') openNew();
    else if (k === 'i' && e.shiftKey) void chooseAndPlaceImage(editor);
    else if (k === 'c') copySelection(editor);
    else if (k === 'x') cutSelection(editor);
    else if (k === 'v') paste(editor);
    else if (k === 'd') duplicateSelection(editor);
    else if (k === 'a') selectAll(editor);
    else if (k === 'g' && e.shiftKey) ungroupSelection(editor);
    else if (k === 'g') groupSelection(editor);
    else if (e.key === ']' || e.code === 'BracketRight') arrangeSelection(editor, e.shiftKey ? 'front' : 'forward');
    else if (e.key === '[' || e.code === 'BracketLeft') arrangeSelection(editor, e.shiftKey ? 'back' : 'backward');
    else if (k === '=' || k === '+' || k === ';') zoomIn();
    else if (k === '-') zoomOut();
    else if (k === '0') zoomToFit();
    else if (k === '1') editor.set({ zoom: 1 });
    else return false;
    return true;
  }
  if (e.altKey) return false;
  if (k === 'delete' || k === 'backspace') deleteSelection(editor);
  else if (k === 'escape') {
    if (editor.getState().pixelSelection) editor.set({ pixelSelection: null });
    else editor.select([]);
  }
  else if (k.startsWith('arrow')) {
    const step = e.shiftKey ? 10 : 1;
    const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0;
    const dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
    nudgeSelection(editor, dx, dy);
  } else if (k.length === 1) {
    // Tool keys: pressing the key of the current group cycles through it.
    const tools = TOOL_GROUPS.flatMap((g) => g.tools).filter((t) => t.key?.toLowerCase() === k);
    if (!tools.length) return false;
    const cur = editor.getState().tool;
    const idx = tools.findIndex((t) => t.id === cur);
    const next: ToolId = tools[(idx + 1) % tools.length].id;
    editor.setTool(next);
  } else return false;
  return true;
}
