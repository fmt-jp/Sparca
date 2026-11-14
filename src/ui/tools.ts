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
    id: 'paint',
    label: 'ブラシ',
    tools: [
      { id: 'brush', label: 'ブラシツール（選択中の画像に描く。画像を選んでいないときは新しい透明な画像に描く）', key: 'B' },
      { id: 'pencil', label: '鉛筆ツール（くっきりした線）', key: 'B' },
      { id: 'eraser', label: '消しゴムツール（選択中の画像を消す）', key: 'E' },
    ],
  },
  {
    id: 'retouch',
    label: 'レタッチ',
    tools: [
      { id: 'clone', label: 'コピースタンプツール（Alt+クリックでコピー元を指定し、ドラッグで写す）', key: 'S' },
      { id: 'blur', label: 'ぼかしブラシ', key: 'O' },
      { id: 'sharpen', label: 'シャープブラシ', key: 'O' },
      { id: 'dodge', label: '覆い焼きツール（明るく）', key: 'O' },
      { id: 'burn', label: '焼き込みツール（暗く）', key: 'O' },
      { id: 'redeye', label: '赤目除去ツール（目をクリック）', key: 'J' },
    ],
  },
  { id: 'line', label: 'ライン', tools: [{ id: 'line', label: 'ラインツール', key: 'N' }] },
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
      { id: 'arrow', label: '矢印ツール', key: 'R' },
    ],
  },
  { id: 'text', label: 'テキスト', tools: [{ id: 'text', label: 'テキストツール', key: 'T' }] },
  { id: 'eyedropper', label: 'スポイト', tools: [{ id: 'eyedropper', label: 'スポイトツール', key: 'I' }] },
  {
    id: 'gradient',
    label: 'グラデーション',
    tools: [{ id: 'gradient', label: 'グラデーションツール（選択中のオブジェクトの上をドラッグして向き・範囲を指定、Shift で 45° 刻み）', key: 'G' }],
  },
  // Hand and zoom share one button (also Space and Ctrl+wheel), as in Fireworks' 表示 section.
  {
    id: 'view',
    label: '表示',
    tools: [
      { id: 'hand', label: '手のひらツール（Space 押下中も可）', key: 'H' },
      { id: 'zoom', label: 'ズームツール（Alt+クリックで縮小）', key: 'Z' },
    ],
  },
];

export function groupOfTool(tool: ToolId): ToolGroup | undefined {
  return TOOL_GROUPS.find((g) => g.tools.some((t) => t.id === tool));
}

export function toolDef(tool: ToolId): ToolDef | undefined {
  return TOOL_GROUPS.flatMap((g) => g.tools).find((t) => t.id === tool);
}
