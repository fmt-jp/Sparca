import { useState } from 'react';
import { GROW_LIMIT } from '../store/editor';
import { growSelection } from '../store/imageActions';
import { Field, NumberInput } from './controls';
import { Dialog } from './Dialog';
import { editor } from './useEditor';

/** Fireworks 選択範囲を拡張／縮小: move the selection's edge out or in by a number of px. */
export function GrowSelectionDialog({ contract, onClose }: { contract: boolean; onClose: () => void }) {
  const [px, setPx] = useState(10);
  const title = contract ? '選択範囲を縮小' : '選択範囲を拡張';
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (growSelection(editor, contract ? -px : px)) onClose();
            }}
          >
            OK
          </button>
        </>
      }
    >
      <Field label={contract ? '縮小する幅' : '拡張する幅'}>
        <NumberInput label={contract ? '縮小する幅' : '拡張する幅'} value={px} min={1} max={GROW_LIMIT} suffix="px" onCommit={setPx} />
      </Field>
      <div className="hint">
        {contract
          ? '選択範囲の輪郭を内側へ指定の幅だけ移動します。'
          : '選択範囲の輪郭を外側へ指定の幅だけ広げます（角は丸くなります）。'}
      </div>
    </Dialog>
  );
}
