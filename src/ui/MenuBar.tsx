import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  alignSelection,
  arrangeSelection,
  chooseAndOpenProject,
  chooseAndPlaceImage,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  saveProject,
  pasteAsMask,
  canPasteAsMask,
  selectAll,
  ungroupSelection,
} from '../store/actions';
import { addGradientMask, addMask, canAddMask, canGroupAsMask, canRemoveMask, groupAsMask, removeMask } from '../store/maskActions';
import { autoColor, eraseSelection, fitCanvasToContent, pixelTargetImage, selectedImage } from '../store/imageActions';
import { ZOOM_STEPS } from './CanvasView';
import { openDialog } from './dialogs';
import { ALIGN, alignShortcut, DISTRIBUTE } from './PropertiesPanel';
import { setPanelSizes, togglePanels, usePanelSizes } from './usePanelSizes';
import { menuCopy, menuPaste } from './clipboard';
import { canConvertSelectionToPaths, convertSelectionToPaths } from '../store/pathActions';
import { canCombineSelection, COMBINE_LABELS } from '../store/pathCombine';
import { attachTextToPath, canAttachTextToPath, canDetachTextFromPath, detachTextFromPath } from '../store/textPathActions';
import { COMBINE_OPS, runCombine } from './combine';
import { editor, useEditor } from './useEditor';

export interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
  /** Shows a check mark (toggle items). */
  checked?: boolean;
  /** Submenu (one level; opens on hover or click). */
  children?: MenuItem[];
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
  const grid = useEditor((s) => s.grid);
  const rulers = useEditor((s) => s.rulers);
  const rulerOrigin = useEditor((s) => s.rulerOrigin);
  const smartGuides = useEditor((s) => s.smartGuides);
  const imagePlacement = useEditor((s) => s.imagePlacement);
  const alignToCanvas = useEditor((s) => s.alignToCanvas);
  const [panels] = usePanelSizes();
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
        { label: '開く…（.hnb／編集できる PNG／PNG・JPEG・GIF・BMP）', shortcut: `${mod}O`, action: () => void chooseAndOpenProject(editor) },
        { separator: true, label: '' },
        { label: '保存', shortcut: `${mod}S`, action: () => void saveProject(editor) },
        { label: '名前を付けて保存…', shortcut: `${mod}Shift+S`, action: () => void saveProject(editor, true) },
        { label: '編集できる PNG として保存…（.hnb.png）', action: () => void saveProject(editor, true, 'png') },
        { label: 'HANABI プロジェクトとして保存…（.hnb）', action: () => void saveProject(editor, true, 'hnb') },
        { separator: true, label: '' },
        { label: '画像を配置…', shortcut: `${mod}Shift+I`, action: () => void chooseAndPlaceImage(editor) },
        { label: 'キャンバスより大きい画像：毎回確認', checked: imagePlacement === 'ask', action: () => editor.set({ imagePlacement: 'ask' }) },
        { label: 'キャンバスより大きい画像：原寸で配置', checked: imagePlacement === 'original', action: () => editor.set({ imagePlacement: 'original' }) },
        { label: 'キャンバスより大きい画像：キャンバスに合わせる', checked: imagePlacement === 'fit', action: () => editor.set({ imagePlacement: 'fit' }) },
        { separator: true, label: '' },
        { label: '画像として書き出し…（PNG / JPEG / WebP / SVG）', shortcut: `${mod}Shift+E`, action: () => openDialog({ kind: 'export' }) },
      ],
    },
    {
      id: 'edit',
      label: '編集',
      items: [
        { label: undoLabel ? `取り消し: ${undoLabel}` : '取り消し', shortcut: `${mod}Z`, action: () => editor.undo(), disabled: !undoLabel },
        { label: redoLabel ? `やり直し: ${redoLabel}` : 'やり直し', shortcut: `${mod}Shift+Z`, action: () => editor.redo(), disabled: !redoLabel },
        { separator: true, label: '' },
        { label: 'カット', shortcut: `${mod}X`, action: () => menuCopy(true), disabled: !hasSel && !(pixelSel && pixelTargetImage(editor)) },
        { label: 'コピー', shortcut: `${mod}C`, action: () => menuCopy(), disabled: !hasSel && !(pixelSel && pixelTargetImage(editor)) },
        { label: 'ペースト', shortcut: `${mod}V`, action: () => void menuPaste() },
        { label: 'マスクとして貼り付け', action: () => pasteAsMask(editor), disabled: !canPasteAsMask(editor) },
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
        { label: 'パスに変換', action: () => convertSelectionToPaths(editor), disabled: !canConvertSelectionToPaths(editor) },
        {
          label: 'パスの結合',
          disabled: !canCombineSelection(editor),
          children: COMBINE_OPS.map((op) => ({ label: COMBINE_LABELS[op], action: () => void runCombine(op) })),
        },
        { separator: true, label: '' },
        { label: 'テキストをパスに添付', shortcut: `${mod}Shift+Y`, action: () => attachTextToPath(editor), disabled: !canAttachTextToPath(editor) },
        { label: 'テキストをパスから外す', action: () => detachTextFromPath(editor), disabled: !canDetachTextFromPath(editor) },
        { separator: true, label: '' },
        { label: 'グラデーションマスクを追加', action: () => addGradientMask(editor), disabled: !canAddMask(editor) },
        { label: 'グループでマスク', action: () => groupAsMask(editor), disabled: !canGroupAsMask(editor) },
        { label: 'マスクを追加（白：全体を表示）', action: () => addMask(editor, 'white'), disabled: !canAddMask(editor) },
        { label: 'マスクを追加（黒：全体を隠す）', action: () => addMask(editor, 'black'), disabled: !canAddMask(editor) },
        { label: 'マスクを削除', action: () => removeMask(editor), disabled: !canRemoveMask(editor) },
        { separator: true, label: '' },
        {
          label: '整列',
          children: [
            ...ALIGN.map((a) => ({
              label: a.label,
              shortcut: alignShortcut(a.digit),
              action: () => alignSelection(editor, a.op, alignToCanvas),
              disabled: !hasSel,
            })),
            { separator: true, label: '' },
            ...DISTRIBUTE.map((a) => ({
              label: a.label,
              shortcut: alignShortcut(a.digit),
              action: () => alignSelection(editor, a.op, alignToCanvas),
              disabled: selection.length < (alignToCanvas ? 2 : 3),
            })),
            { separator: true, label: '' },
            { label: 'キャンバスに対して整列', checked: alignToCanvas, action: () => editor.set({ alignToCanvas: !alignToCanvas }) },
          ],
        },
        { separator: true, label: '' },
        { label: 'キャンバスサイズ…', action: () => openDialog({ kind: 'canvas-size' }) },
        { label: 'キャンバスを内容に合わせる', action: () => fitCanvasToContent(editor) },
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
        { label: '選択範囲にモザイク…', action: () => openDialog({ kind: 'mosaic-selection' }), disabled: !pixelSel || !pixelTargetImage(editor) },
        { label: '選択範囲を消去', shortcut: 'Delete', action: () => eraseSelection(editor), disabled: !pixelSel || !pixelTargetImage(editor) },
        { label: '選択範囲を拡張…', action: () => openDialog({ kind: 'grow-selection', contract: false }), disabled: !pixelSel },
        { label: '選択範囲を縮小…', action: () => openDialog({ kind: 'grow-selection', contract: true }), disabled: !pixelSel },
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
        { separator: true, label: '' },
        { label: 'ルーラーを表示', checked: rulers, action: () => editor.set({ rulers: !rulers }) },
        { label: 'ルーラー：キャンバスの左上を 0', checked: rulerOrigin === 'corner', action: () => editor.set({ rulerOrigin: 'corner', rulers: true }) },
        { label: 'ルーラー：キャンバスの中心を 0', checked: rulerOrigin === 'center', action: () => editor.set({ rulerOrigin: 'center', rulers: true }) },
        { label: 'スマートガイド（キャンバスの中央に合わせる）', checked: smartGuides, action: () => editor.set({ smartGuides: !smartGuides }) },
        { label: 'グリッドを表示', checked: grid.visible, action: () => editor.setGrid({ visible: !grid.visible }) },
        { label: 'グリッドにスナップ', checked: grid.snap, action: () => editor.setGrid({ snap: !grid.snap }) },
        { label: 'グリッド設定…', action: () => openDialog({ kind: 'grid' }) },
        { separator: true, label: '' },
        { label: 'レイヤーパネル', checked: !panels.layersHidden, action: () => setPanelSizes({ layersHidden: !panels.layersHidden }) },
        { label: 'プロパティパネル', checked: !panels.propsHidden, action: () => setPanelSizes({ propsHidden: !panels.propsHidden }) },
        {
          label: panels.layersHidden && panels.propsHidden ? 'パネルをすべて表示' : 'パネルをすべて隠す',
          shortcut: 'F4',
          action: togglePanels,
        },
      ],
    },
    {
      id: 'help',
      label: 'ヘルプ',
      items: [
        { label: '操作ガイド…', shortcut: 'F1', action: () => openDialog({ kind: 'help' }) },
        { label: 'キーボードショートカット…', action: () => openDialog({ kind: 'help', section: 'shortcuts' }) },
        { label: '動作環境…', action: () => openDialog({ kind: 'help', section: 'environment' }) },
      ],
    },
  ];

  return (
    <header className="menubar" ref={ref}>
      <span className="app-name">
        <img className="app-icon" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={20} height={20} />
        HANABI
      </span>
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
            <div className="menu-list" role="menu" aria-label={m.label}>
              {m.items.map((it, i) =>
                it.separator ? (
                  <hr key={i} />
                ) : it.children ? (
                  <MenuSubmenu key={i} item={it} onDone={() => setOpen(null)} />
                ) : (
                  <button
                    key={i}
                    type="button"
                    role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                    aria-checked={it.checked}
                    className="menu-item"
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(null);
                      it.action?.();
                    }}
                  >
                    <span>
                      {it.checked !== undefined && <span className="check">{it.checked ? '✓' : ''}</span>}
                      {it.label}
                    </span>
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
          <button type="button" title="ズームアウト" aria-label="ズームアウト" onClick={zoomOut}>
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
          <button type="button" title="ズームイン" aria-label="ズームイン" onClick={zoomIn}>
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

/** A menu bar item with a submenu: opens to the right on hover or click (one level). */
function MenuSubmenu({ item, onDone }: { item: MenuItem; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setFlip(r.right + r.width > window.innerWidth - 4);
  }, [open]);
  return (
    <div ref={ref} className={`context-submenu${flip ? ' flip' : ''}`} onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className="menu-item"
        disabled={item.disabled}
        onClick={() => setOpen(true)}
      >
        <span>{item.label}</span>
        <span aria-hidden="true">▸</span>
      </button>
      {open && !item.disabled && (
        <div className="menu-list menubar-sub" role="menu" aria-label={item.label}>
          {item.children!.map((it, i) =>
            it.separator ? (
              <hr key={i} />
            ) : (
              <button
                key={i}
                type="button"
                role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={it.checked}
                className="menu-item"
                disabled={it.disabled}
                onClick={() => {
                  onDone();
                  it.action?.();
                }}
              >
                <span>
                  {it.checked !== undefined && <span className="check">{it.checked ? '✓' : ''}</span>}
                  {it.label}
                </span>
                {it.shortcut && <kbd>{it.shortcut}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
