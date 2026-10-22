import { useState } from 'react';
import { pixelTargetImage } from '../store/imageActions';
import { Field, SliderInput, Toggle } from './controls';
import { Dialog } from './Dialog';
import { editor } from './useEditor';
import { useSelectionPreview } from './useSelectionPreview';

/** Gaussian blur applied to the pixel selection of the target image (spec §7.6). */
export function BlurSelectionDialog({ onClose }: { onClose: () => void }) {
  const [radius, setRadius] = useState(6);
  const target = pixelTargetImage(editor);
  const { preview, setPreview, apply } = useSelectionPreview('blur', radius);
  return (
    <Dialog
      clearBackdrop={preview}
      title="選択範囲にぼかし"
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
      <Field label="ぼかし強度">
        <SliderInput label="ぼかし強度" value={radius} min={0.5} max={100} step={0.5} precision={1} suffix="px" onChange={setRadius} />
      </Field>
      <Toggle checked={preview} onChange={setPreview}>
        プレビュー（適用前にキャンバスで確認）
      </Toggle>
      <div className="hint">ぼかしは編集情報として保持され、画像のプロパティからいつでも取り消せます。</div>
    </Dialog>
  );
}
