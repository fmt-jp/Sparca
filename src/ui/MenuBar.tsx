import { useEffect, useRef, useState } from 'react';
import {
  arrangeSelection,
  chooseAndOpenProject,
  chooseAndPlaceImage,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  hasClipboard,
  paste,
  saveProject,
  selectAll,
  ungroupSelection,
} from '../store/actions';
import { autoColor, pixelTargetImage, selectedImage } from '../store/imageActions';
import { ZOOM_STEPS } from './CanvasView';
import { openDialog } from './dialogs';
import { editor, useEditor } from './useEditor';

export interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

export function zoomIn() {
  const z = editor.getState().zoom;
  editor.set({ zoom: ZOOM_STEPS.find((s) => s > z + 1e-6) ?? z });
}
export function zoomOut() {
  const z = editor.getState().zoom;
  editor.set({ zoom: [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) ?? z });
}
export function zoomToFit() {
  const ws = document.querySelector('[data-testid="workspace"]');
  const { doc } = editor.getState();
  if (!ws) return;
  const z = Math.min((ws.clientWidth - 40) / doc.width, (ws.clientHeight - 40) / doc.height);
  editor.set({ zoom: Math.max(0.0625, Math.min(32, z)) });
}

export function MenuBar({ onNew }: { onNew: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const history = useEditor((s) => s.history);
  const selection = useEditor((s) => s.selection);
  const zoom = useEditor((s) => s.zoom);
  const fileName = useEditor((s) => s.fileName);
  const dirty = useEditor((s) => s.doc !== s.savedDoc);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const hasSel = selection.length > 0;
  const pixelSel = useEditor((s) => s.pixelSelection);
  const image = selectedImage(editor);
  const undoLabel = history.past[history.past.length - 1]?.label;
  const redoLabel = history.future[0]?.label;

  const menus: { id: string; label: string; items: MenuItem[] }[] = [
    {
      id: 'file',
      label: 'ファイル',
      items: [
        // No shortcut: browsers reserve Ctrl+N for a new window.
        { label: '新規…', action: onNew },
        { label: '開く…（.sparca／PNG・JPEG・GIF・BMP）', shortcut: `${mod}O`, action: () => void chooseAndOpenProject(editor) },
        { separator: true, label: '' },
        { label: '保存', shortcut: `${mod}S`, action: () => void saveProject(editor) },
        { label: '名前を付けて保存…', shortcut: `${mod}Shift+S`, action: () => void saveProject(editor, true) },
        { separator: true, label: '' },
        { label: '画像を配置…', shortcut: `${mod}Shift+I`, action: () => void chooseAndPlaceImage(editor) },
        { separator: true, label: '' },
        { label: '画像として書き出し…（PNG / JPEG / WebP）', shortcut: `${mod}Shift+E`, action: () => openDialog({ kind: 'export' }) },
      ],
    },
    {
      id: 'edit',
      label: '編集',
      items: [
        { label: undoLabel ? `取り消し: ${undoLabel}` : '取り消し', shortcut: `${mod}Z`, action: () => editor.undo(), disabled: !undoLabel },
        { label: redoLabel ? `やり直し: ${redoLabel}` : 'やり直し', shortcut: `${mod}Shift+Z`, action: () => editor.redo(), disabled: !redoLabel },
        { separator: true, label: '' },
        { label: 'カット', shortcut: `${mod}X`, action: () => cutSelection(editor), disabled: !hasSel },
        { label: 'コピー', shortcut: `${mod}C`, action: () => copySelection(editor), disabled: !hasSel },
        { label: 'ペースト', shortcut: `${mod}V`, action: () => paste(editor), disabled: !hasClipboard() },
        { label: '複製', shortcut: `${mod}D`, action: () => duplicateSelection(editor), disabled: !hasSel },
        { label: '削除', shortcut: 'Delete', action: () => deleteSelection(editor), disabled: !hasSel },
        { separator: true, label: '' },
        { label: 'すべてを選択', shortcut: `${mod}A`, action: () => selectAll(editor) },
        { label: '選択解除', shortcut: 'Esc', action: () => editor.select([]), disabled: !hasSel },
      ],
    },
    {
      id: 'modify',
      label: '変更',
      items: [
        { label: '最前面へ', shortcut: `${mod}Shift+]`, action: () => arrangeSelection(editor, 'front'), disabled: !hasSel },
        { label: '前面へ', shortcut: `${mod}]`, action: () => arrangeSelection(editor, 'forward'), disabled: !hasSel },
        { label: '背面へ', shortcut: `${mod}[`, action: () => arrangeSelection(editor, 'backward'), disabled: !hasSel },
        { label: '最背面へ', shortcut: `${mod}Shift+[`, action: () => arrangeSelection(editor, 'back'), disabled: !hasSel },
        { separator: true, label: '' },
        { label: 'グループ化', shortcut: `${mod}G`, action: () => groupSelection(editor), disabled: selection.length < 2 },
        { label: 'グループ解除', shortcut: `${mod}Shift+G`, action: () => ungroupSelection(editor), disabled: !hasSel },
        { separator: true, label: '' },
        { label: 'キャンバスサイズ…', action: () => openDialog({ kind: 'canvas-size' }) },
        { label: '画像サイズ…（選択中の画像）', action: () => image && openDialog({ kind: 'image-size', imageId: image.id }), disabled: !image },
        { label: 'トリミング', shortcut: 'C', action: () => editor.setTool('crop') },
      ],
    },
    {
      id: 'image',
      label: '画像',
      items: [
        { label: '自動カラー調整', action: () => image && void autoColor(editor, image.id), disabled: !image },
        { label: '選択範囲にぼかし…', action: () => openDialog({ kind: 'blur-selection' }), disabled: !pixelSel || !pixelTargetImage(editor) },
        { label: '範囲選択を解除', shortcut: 'Esc', action: () => editor.set({ pixelSelection: null }), disabled: !pixelSel },
      ],
    },
    {
      id: 'view',
      label: '表示',
      items: [
        { label: 'ズームイン', shortcut: `${mod}+`, action: zoomIn },
        { label: 'ズームアウト', shortcut: `${mod}-`, action: zoomOut },
        { label: '100%', shortcut: `${mod}1`, action: () => editor.set({ zoom: 1 }) },
        { label: '画面に合わせる', shortcut: `${mod}0`, action: zoomToFit },
      ],
    },
  ];

  return (
    <header className="menubar" ref={ref}>
      <span className="app-name">Sparca</span>
      {menus.map((m) => (
        <div key={m.id} className="menu">
          <button
            type="button"
            className={`menu-title${open === m.id ? ' open' : ''}`}
            onClick={() => setOpen(open === m.id ? null : m.id)}
            onPointerEnter={() => open && setOpen(m.id)}
          >
            {m.label}
          </button>
          {open === m.id && (
            <div className="menu-list" role="menu">
              {m.items.map((it, i) =>
                it.separator ? (
                  <hr key={i} />
                ) : (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(null);
                      it.action?.();
                    }}
                  >
                    <span>{it.label}</span>
                    {it.shortcut && <kbd>{it.shortcut}</kbd>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
      <div className="menubar-spacer" />
      <div className="quick-actions">
        <button type="button" title={`取り消し（${mod}Z）`} disabled={!undoLabel} onClick={() => editor.undo()}>
          ↶
        </button>
        <button type="button" title={`やり直し（${mod}Shift+Z）`} disabled={!redoLabel} onClick={() => editor.redo()}>
          ↷
        </button>
        <span className="zoom-control">
          <button type="button" title="ズームアウト" onClick={zoomOut}>
            −
          </button>
          <select
            aria-label="表示倍率"
            value={ZOOM_STEPS.includes(zoom) ? String(zoom) : 'custom'}
            onChange={(e) => editor.set({ zoom: Number(e.target.value) })}
          >
            {!ZOOM_STEPS.includes(zoom) && <option value="custom">{Math.round(zoom * 100)}%</option>}
            {ZOOM_STEPS.map((z) => (
              <option key={z} value={z}>
                {Math.round(z * 1000) / 10}%
              </option>
            ))}
          </select>
          <button type="button" title="ズームイン" onClick={zoomIn}>
            ＋
          </button>
        </span>
        <button type="button" className="primary" onClick={() => void saveProject(editor)} title={`${mod}S`}>
          保存
        </button>
      </div>
      <span className="doc-title" title={dirty ? '未保存の変更があります' : '保存済み'}>
        {fileName}
        {dirty && <span className="dirty-mark"> ●未保存</span>}
      </span>
    </header>
  );
}
