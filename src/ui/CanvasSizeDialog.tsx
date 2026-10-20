// Canvas size dialog (spec §7.3): new width/height and a 9-point anchor.
import { useState } from 'react';
import { ANCHORS, canvasOffset, type Anchor } from '../model/imageOps';
import { validateDimensions } from '../store/assets';
import { changeCanvasSize } from '../store/imageActions';
import { Field, NumberInput } from './controls';
import { Dialog } from './Dialog';
import { editor, useEditor } from './useEditor';

export function CanvasSizeDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const [width, setWidth] = useState(doc.width);
  const [height, setHeight] = useState(doc.height);
  const [anchor, setAnchor] = useState<Anchor>({ x: 0.5, y: 0.5 });
  const problem = validateDimensions(width, height);
  const off = canvasOffset(doc.width, doc.height, width, height, anchor);

  function describe(delta: number, before: number, after: number, a: number, axis: 'x' | 'y'): string {
    if (delta === 0) return '';
    const [s1, s2] = axis === 'x' ? ['左', '右'] : ['上', '下'];
    const verb = delta > 0 ? '余白を追加' : '切り落とし';
    const d = Math.abs(after - before);
    if (a === 0) return `${s2}に ${d}px ${verb}`;
    if (a === 1) return `${s1}に ${d}px ${verb}`;
    return `${s1}${s2}に ${d / 2}px ずつ${verb}`;
  }
  const notes = [
    describe(width - doc.width, doc.width, width, anchor.x, 'x'),
    describe(height - doc.height, doc.height, height, anchor.y, 'y'),
  ].filter(Boolean);

  return (
    <Dialog
      title="キャンバスサイズ"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="primary"
            disabled={!!problem}
            onClick={() => {
              if (changeCanvasSize(editor, width, height, anchor)) onClose();
            }}
          >
            適用
          </button>
        </>
      }
    >
      <div className="hint">
        現在: {doc.width} × {doc.height} px。内部の画像や図形は拡大縮小されません。
      </div>
      <div className="field-row">
        <Field label="幅">
          <NumberInput label="幅" value={width} min={1} max={16384} suffix="px" onCommit={(v) => setWidth(Math.round(v))} />
        </Field>
        <Field label="高さ">
          <NumberInput label="高さ" value={height} min={1} max={16384} suffix="px" onCommit={(v) => setHeight(Math.round(v))} />
        </Field>
      </div>
      <Field label="基準位置">
        <div className="anchor-grid" role="radiogroup" aria-label="基準位置">
          {ANCHORS.map((a) => {
            const on = a.anchor.x === anchor.x && a.anchor.y === anchor.y;
            return (
              <button
                key={a.label}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={a.label}
                title={a.label}
                className={`anchor-cell${on ? ' on' : ''}`}
                onClick={() => setAnchor(a.anchor)}
              />
            );
          })}
        </div>
      </Field>
      <div className={problem ? 'error-text' : 'result-size'}>
        {problem ?? (notes.length ? notes.join('、') : '変更なし')}
      </div>
      {!problem && (off.x !== 0 || off.y !== 0) && (
        <div className="hint">
          既存のオブジェクトは X {off.x >= 0 ? '+' : ''}
          {off.x}px、Y {off.y >= 0 ? '+' : ''}
          {off.y}px 移動します。キャンバス外に出たオブジェクトは削除されず、書き出しには含まれません。
        </div>
      )}
    </Dialog>
  );
}
