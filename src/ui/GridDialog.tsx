// Grid settings (View > グリッド設定…): show, spacing, color, snap.
import { GRID_SIZE_LIMITS } from '../store/editor';
import { ColorInput, Field, NumberInput, Toggle } from './controls';
import { Dialog } from './Dialog';
import { editor, useEditor } from './useEditor';

export function GridDialog({ onClose }: { onClose: () => void }) {
  const grid = useEditor((s) => s.grid);
  return (
    <Dialog
      title="グリッド設定"
      onClose={onClose}
      footer={
        <button type="button" className="primary" onClick={onClose}>
          閉じる
        </button>
      }
    >
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
        グリッドにスナップ（移動・拡大縮小・描画の位置をグリッドに合わせる）
      </Toggle>
      <div className="hint">グリッドは画面表示用で、書き出し画像やプロジェクトファイルには含まれません。設定はこのブラウザに保存されます。</div>
    </Dialog>
  );
}
