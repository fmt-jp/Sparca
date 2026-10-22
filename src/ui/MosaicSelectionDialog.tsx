import { useState } from 'react';
import { pixelTargetImage } from '../store/imageActions';
import { Field, SliderInput, Toggle } from './controls';
import { Dialog } from './Dialog';
import { editor } from './useEditor';
import { useSelectionPreview } from './useSelectionPreview';

/** Mosaic (pixelation) applied to the pixel selection of the target image. */
export function MosaicSelectionDialog({ onClose }: { onClose: () => void }) {
  const [size, setSize] = useState(10);
  const target = pixelTargetImage(editor);
  const { preview, setPreview, apply } = useSelectionPreview('mosaic', size);
  return (
    <Dialog
      clearBackdrop={preview}
      title="選択範囲にモザイク"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="primary"
            disabled={!target}
            onClick={() => {
              if (apply()) onClose();
            }}
          >
            適用
          </button>
        </>
      }
    >
      <div className="hint">
        {target ? `対象: ${target.name}` : '選択範囲に重なる編集可能な画像がありません。'}
      </div>
      <Field label="ブロックの大きさ">
        <SliderInput label="ブロックの大きさ" value={size} min={2} max={200} step={1} suffix="px" onChange={setSize} />
      </Field>
      <Toggle checked={preview} onChange={setPreview}>
        プレビュー（適用前にキャンバスで確認）
      </Toggle>
      <div className="hint">モザイクは編集情報として保持され、画像のプロパティからいつでも取り消せます。</div>
    </Dialog>
  );
}
