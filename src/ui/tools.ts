import type { ToolId } from '../store/editor';

export interface ToolDef {
  id: ToolId;
  label: string;
  /** Single-key shortcut; pressing it again cycles through the tool's group. */
  key?: string;
}

export interface ToolGroup {
  id: string;
  label: string;
  tools: ToolDef[];
}

/**
 * Toolbar layout. Only tools that are implemented are listed here;
 * tools still to be built must not appear (spec §17).
 */
export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'select',
    label: '選択',
    tools: [
      { id: 'select', label: '選択ツール', key: 'V' },
      { id: 'subselect', label: '部分選択ツール（パスのアンカー・ハンドルを編集）', key: 'A' },
    ],
  },
  { id: 'crop', label: 'トリミング', tools: [{ id: 'crop', label: 'トリミングツール（Enter で確定、Esc で取消）', key: 'C' }] },
  {
    id: 'marquee',
    label: '範囲選択',
    tools: [
      { id: 'marquee-rect', label: '矩形選択ツール', key: 'M' },
      { id: 'marquee-ellipse', label: '楕円選択ツール', key: 'M' },
      { id: 'lasso', label: '投げ縄ツール', key: 'L' },
      { id: 'polygon-lasso', label: '多角形選択ツール（クリックで頂点、始点クリック／ダブルクリック／Enter で閉じる）', key: 'L' },
    ],
  },
  {
    id: 'line',
    label: 'ライン',
    tools: [
      { id: 'line', label: 'ラインツール', key: 'N' },
      { id: 'arrow', label: '矢印ツール', key: 'N' },
    ],
  },
  { id: 'pen', label: 'ペン', tools: [{ id: 'pen', label: 'ペンツール（クリックで角、ドラッグで曲線、始点クリックで閉じる、Enter で終了）', key: 'P' }] },
  {
    id: 'shape',
    label: '図形',
    tools: [
      { id: 'rect', label: '矩形ツール', key: 'R' },
      { id: 'rounded-rect', label: '角丸矩形ツール', key: 'R' },
      { id: 'ellipse', label: '楕円ツール', key: 'R' },
      { id: 'polygon', label: '多角形ツール', key: 'R' },
      { id: 'star', label: '星ツール', key: 'R' },
    ],
  },
  { id: 'text', label: 'テキスト', tools: [{ id: 'text', label: 'テキストツール', key: 'T' }] },
  { id: 'eyedropper', label: 'スポイト', tools: [{ id: 'eyedropper', label: 'スポイトツール', key: 'I' }] },
  { id: 'hand', label: '手のひら', tools: [{ id: 'hand', label: '手のひらツール（Space 押下中も可）', key: 'H' }] },
  { id: 'zoom', label: 'ズーム', tools: [{ id: 'zoom', label: 'ズームツール（Alt+クリックで縮小）', key: 'Z' }] },
];

export function groupOfTool(tool: ToolId): ToolGroup | undefined {
  return TOOL_GROUPS.find((g) => g.tools.some((t) => t.id === tool));
}

export function toolDef(tool: ToolId): ToolDef | undefined {
  return TOOL_GROUPS.flatMap((g) => g.tools).find((t) => t.id === tool);
}
