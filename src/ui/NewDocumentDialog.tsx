import { useState } from 'react';
import { newDocument } from '../store/actions';
import { ColorInput, Field, NumberInput, Toggle } from './controls';
import { Dialog } from './Dialog';
import { editor } from './useEditor';

export function NewDocumentDialog({ onClose }: { onClose: () => void }) {
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);
  const [transparent, setTransparent] = useState(false);
  const [color, setColor] = useState('#ffffff');

  function create() {
    if (editor.dirty && !window.confirm('保存していない変更は失われます。新規ドキュメントを作成しますか？')) return;
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
