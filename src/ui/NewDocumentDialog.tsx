import { useState } from 'react';
import { newDocument } from '../store/actions';
import { ColorInput, Field, NumberInput, Toggle } from './controls';
import { Dialog } from './Dialog';
import { editor } from './useEditor';

/** Size presets of the new document dialog (decided with the user 2026-11-01). */
export const SIZE_PRESETS: { label: string; width: number; height: number }[] = [
  { label: '1:1（1080 × 1080 px）', width: 1080, height: 1080 },
  { label: '16:9（1920 × 1080 px）', width: 1920, height: 1080 },
  { label: '4:3（1600 × 1200 px）', width: 1600, height: 1200 },
];

export function NewDocumentDialog({ onClose }: { onClose: () => void }) {
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);
  const [transparent, setTransparent] = useState(false);
  const [color, setColor] = useState('#ffffff');

  function create() {
    const ok = newDocument(editor, width, height, transparent ? { kind: 'transparent' } : { kind: 'color', color });
    if (ok) onClose();
  }

  return (
    <Dialog
      title="新規ドキュメント"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className="primary" onClick={create}>
            作成
          </button>
        </>
      }
    >
      <Field label="サイズ">
        <select
          aria-label="サイズ"
          // Shows the preset the numbers match, or 「数値で指定」 for any other size.
          value={String(SIZE_PRESETS.findIndex((p) => p.width === width && p.height === height))}
          onChange={(e) => {
            const p = SIZE_PRESETS[Number(e.target.value)];
            if (!p) return;
            setWidth(p.width);
            setHeight(p.height);
          }}
        >
          <option value="-1">数値で指定</option>
          {SIZE_PRESETS.map((p, i) => (
            <option key={p.label} value={String(i)}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="幅">
        <NumberInput label="幅" value={width} min={1} max={16384} suffix="px" onCommit={setWidth} />
      </Field>
      <Field label="高さ">
        <NumberInput label="高さ" value={height} min={1} max={16384} suffix="px" onCommit={setHeight} />
      </Field>
      <Toggle checked={transparent} onChange={setTransparent}>
        透明な背景
      </Toggle>
      {!transparent && (
        <Field label="背景色">
          <ColorInput label="背景色" value={color} onChange={(c) => setColor(c ?? '#ffffff')} />
        </Field>
      )}
    </Dialog>
  );
}
