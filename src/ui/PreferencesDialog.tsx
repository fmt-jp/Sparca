// 編集 → 環境設定…: per-browser preferences gathered in one place (rulers' origin, smart
// guides, grid, how a large image is placed). Frequent toggles (ルーラーを表示, グリッドを表示,
// グリッドにスナップ) stay in the 表示 menu as well.
import type { ReactNode } from 'react';
import { GRID_SIZE_LIMITS, type ImagePlacement } from '../store/editor';
import { ColorInput, Field, NumberInput, Toggle } from './controls';
import { Dialog } from './Dialog';
import { editor, useEditor } from './useEditor';
import { hasFileSystemAccess } from '../io/files';
import { RECENT_LIMIT } from '../store/recentFiles';

function Radios<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, ReactNode][]; onChange: (v: T) => void }) {
  return (
    <div className="radio-row prefs-radios" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <label key={v}>
          <input type="radio" name={label} checked={value === v} onChange={() => onChange(v)} /> {text}
        </label>
      ))}
    </div>
  );
}

export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const grid = useEditor((s) => s.grid);
  const rulerOrigin = useEditor((s) => s.rulerOrigin);
  const smartGuides = useEditor((s) => s.smartGuides);
  const explanations = useEditor((s) => s.explanations);
  const recentLimit = useEditor((s) => s.recentLimit);
  const imagePlacement = useEditor((s) => s.imagePlacement);
  const restoreMode = useEditor((s) => s.restoreMode);
  return (
    <Dialog
      title="環境設定"
      onClose={onClose}
      footer={
        <button type="button" className="primary" onClick={onClose}>
          閉じる
        </button>
      }
    >
      <h3 className="prefs-heading">画面の説明</h3>
      <Toggle checked={explanations} onChange={(v) => editor.set({ explanations: v })}>
        画面の説明を表示（パネルやダイアログの使い方の説明。オフでも、大きさ・数などの情報と注意・エラーは表示）
      </Toggle>

      <h3 className="prefs-heading">ルーラーとガイド</h3>
      <Field label="ルーラーの原点">
        <Radios
          label="ルーラーの原点"
          value={rulerOrigin}
          options={[
            ['corner', 'キャンバスの左上を 0'],
            ['center', 'キャンバスの中心を 0'],
          ]}
          onChange={(v) => editor.set({ rulerOrigin: v })}
        />
      </Field>
      <Toggle checked={smartGuides} onChange={(v) => editor.set({ smartGuides: v })}>
        スマートガイド<span className="explain">（ドラッグ中、ほかのオブジェクトやキャンバスの端・中央に合わせる）</span>
      </Toggle>

      <h3 className="prefs-heading">グリッド</h3>
      <Toggle checked={grid.visible} onChange={(visible) => editor.setGrid({ visible })}>
        グリッドを表示
      </Toggle>
      <Field label="間隔">
        <NumberInput
          label="グリッドの間隔"
          value={grid.size}
          min={GRID_SIZE_LIMITS[0]}
          max={GRID_SIZE_LIMITS[1]}
          suffix="px"
          onCommit={(size) => editor.setGrid({ size: Math.round(size) })}
        />
      </Field>
      <Field label="色">
        <ColorInput label="グリッドの色" value={grid.color} onChange={(color) => editor.setGrid({ color: color ?? '#00a0ff' })} />
      </Field>
      <Toggle checked={grid.snap} onChange={(snap) => editor.setGrid({ snap })}>
        グリッドにスナップ<span className="explain">（移動・拡大縮小・描画の位置をグリッドに合わせる）</span>
      </Toggle>

      <h3 className="prefs-heading">画像の配置</h3>
      <Field label="キャンバスより大きい画像">
        <Radios<ImagePlacement>
          label="キャンバスより大きい画像"
          value={imagePlacement}
          options={[
            ['ask', '毎回確認'],
            ['original', '原寸で配置'],
            ['fit', 'キャンバスに合わせる'],
          ]}
          onChange={(v) => editor.set({ imagePlacement: v })}
        />
      </Field>
      <h3 className="prefs-heading">最近使ったファイル</h3>
      <Field label="覚えておく数">
        <NumberInput
          label="最近使ったファイルの数"
          value={recentLimit}
          min={RECENT_LIMIT.min}
          max={RECENT_LIMIT.max}
          suffix="件"
          onCommit={(v) => editor.set({ recentLimit: Math.round(v) })}
        />
      </Field>
      <div className="hint">
        {hasFileSystemAccess() ? (
          <span className="explain">「ファイル」→「最近使ったファイル」に、保存したり開いたりしたファイルをこの数だけ新しい順に出します（0 で記録しない）。</span>
        ) : (
          'このブラウザではファイルの場所を覚えられないため、最近使ったファイルは使えません（Chrome・Edge で使えます）。'
        )}
      </div>
      <h3 className="prefs-heading">自動保存</h3>
      <Field label="前回の作業が残っていたら">
        <Radios<'ask' | 'auto'>
          label="前回の作業が残っていたら"
          value={restoreMode}
          options={[
            ['ask', '確認してから復元'],
            ['auto', '自動で復元'],
          ]}
          onChange={(v) => editor.set({ restoreMode: v })}
        />
      </Field>
      <div className="hint explain">保存していない変更は、30 秒ほどでこのブラウザの中に自動保存されます（PC のファイルは増えません）。ブラウザが落ちたりタブを閉じたりしても、次に開いたときに復元できます。</div>
      <div className="hint explain">ルーラー・ガイド・グリッドは画面表示用で、書き出し画像やプロジェクトファイルには含まれません。設定はこのブラウザに保存されます。</div>
    </Dialog>
  );
}
