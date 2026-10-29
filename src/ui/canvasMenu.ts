// Items of the canvas right-click menu: for objects, empty canvas, and path anchors.
import { findObject, isEffectivelyLocked } from '../model/tree';
import { segmentCount, pathToDoc } from '../model/pathEdit';
import {
  alignSelection,
  arrangeSelection,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  selectAll,
  ungroupSelection,
} from '../store/actions';
import { canConvertSelectionToPaths, convertSelectedNodes, convertSelectionToPaths, deleteSelectedNodes, editablePath, insertNode, isLineShape } from '../store/pathActions';
import type { MenuItem } from './MenuBar';
import { ALIGN, alignShortcut, DISTRIBUTE } from './PropertiesPanel';
import { menuCopy, menuPaste } from './clipboard';
import { canCopyPixels } from '../store/pixelCopy';
import { editor } from './useEditor';

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
const SEP: MenuItem = { separator: true, label: '' };

/** Menu for the current object selection. */
export function objectMenu(): MenuItem[] {
  const { doc, selection, alignToCanvas } = editor.getState();
  const has = selection.length > 0;
  const single = selection.length === 1 ? findObject(doc, selection[0]) : null;
  const isGroup = selection.some((id) => findObject(doc, id)?.object.type === 'group');
  const items: MenuItem[] = [
    { label: 'カット', shortcut: `${mod}X`, action: () => menuCopy(true), disabled: !has },
    { label: 'コピー', shortcut: `${mod}C`, action: () => menuCopy(), disabled: !has && !canCopyPixels(editor) },
    { label: 'ペースト', shortcut: `${mod}V`, action: () => void menuPaste() },
    { label: '複製', shortcut: `${mod}D`, action: () => duplicateSelection(editor), disabled: !has },
    { label: '削除', shortcut: 'Delete', action: () => deleteSelection(editor), disabled: !has },
    SEP,
    { label: '最前面へ', shortcut: `${mod}Shift+]`, action: () => arrangeSelection(editor, 'front'), disabled: !has },
    { label: '最背面へ', shortcut: `${mod}Shift+[`, action: () => arrangeSelection(editor, 'back'), disabled: !has },
    SEP,
    { label: 'グループ化', shortcut: `${mod}G`, action: () => groupSelection(editor), disabled: selection.length < 2 },
    { label: 'グループ解除', shortcut: `${mod}Shift+G`, action: () => ungroupSelection(editor), disabled: !isGroup },
    SEP,
    { label: 'パスに変換', action: () => convertSelectionToPaths(editor), disabled: !canConvertSelectionToPaths(editor) },
    SEP,
    {
      label: '整列',
      disabled: !has,
      children: [
        ...ALIGN.map((a) => ({ label: a.label, shortcut: alignShortcut(a.digit), action: () => alignSelection(editor, a.op, alignToCanvas) })),
        SEP,
        ...DISTRIBUTE.map((a) => ({
          label: a.label,
          shortcut: alignShortcut(a.digit),
          action: () => alignSelection(editor, a.op, alignToCanvas),
          disabled: selection.length < (alignToCanvas ? 2 : 3),
        })),
        SEP,
        { label: 'キャンバスに対して', checked: alignToCanvas, action: () => editor.set({ alignToCanvas: !alignToCanvas }) },
      ],
    },
  ];
  if ((single?.object.type === 'path' || isLineShape(single?.object)) && !isEffectivelyLocked(single!) && editor.getState().tool !== 'subselect') {
    items.push(SEP, {
      label: 'パスの編集',
      action: () => {
        editor.select([single.object.id]);
        editor.setTool('subselect');
      },
    });
  }
  return items;
}

/** Menu for an empty spot of the canvas. */
export function canvasMenu(): MenuItem[] {
  const { grid } = editor.getState();
  return [
    ...(canCopyPixels(editor) ? [{ label: '選択範囲をコピー', shortcut: `${mod}C`, action: () => menuCopy() }] : []),
    { label: 'ペースト', shortcut: `${mod}V`, action: () => void menuPaste() },
    { label: 'すべてを選択', shortcut: `${mod}A`, action: () => selectAll(editor) },
    SEP,
    { label: 'グリッドを表示', checked: grid.visible, action: () => editor.setGrid({ visible: !grid.visible }) },
  ];
}

/**
 * Menu for path anchors (subselect tool). `insertAt` is where 「点の追加」 inserts:
 * the clicked spot on the outline, or the middle of the segment after the clicked anchor.
 */
export function anchorMenu(insertAt: { segment: number; t: number } | null): MenuItem[] {
  const p = editablePath(editor);
  const sel = p ? editor.getState().nodeSelection.filter((i) => i < p.nodes.length) : [];
  const ins = insertAt;
  return [
    { label: '点の追加', action: () => ins && insertNode(editor, ins.segment, ins.t), disabled: !ins },
    { label: '点の削除', shortcut: 'Delete', action: () => deleteSelectedNodes(editor), disabled: !sel.length },
    SEP,
    { label: '角の点に変換', action: () => convertSelectedNodes(editor, 'corner'), disabled: !sel.length },
    { label: '滑らかな点に変換', action: () => convertSelectedNodes(editor, 'smooth'), disabled: !sel.length },
  ];
}

/** Segment to split for 「点の追加」 on anchor i: the one after it, or before it at an open path's end. */
export function segmentNextTo(i: number): { segment: number; t: number } | null {
  const p = editablePath(editor);
  if (!p) return null;
  const n = segmentCount(pathToDoc(p), p.closed);
  if (!n) return null;
  return { segment: i < n ? i : n - 1, t: 0.5 };
}
