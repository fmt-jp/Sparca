// Asked when an image larger than the canvas is placed, dropped or pasted: keep its
// original size or scale it down to fit the canvas (pixels are kept either way).
import { useState } from 'react';
import type { PlacementAnswer, PlacementQuestion } from '../store/actions';
import { Toggle } from './controls';
import { Dialog } from './Dialog';

export function ImagePlacementDialog({ question: q, answer }: { question: PlacementQuestion; answer: (a: PlacementAnswer | null) => void }) {
  const [remember, setRemember] = useState(false);
  const k = Math.min(q.canvasWidth / q.width, q.canvasHeight / q.height);
  const fitW = Math.max(1, Math.round(q.width * k));
  const fitH = Math.max(1, Math.round(q.height * k));
  return (
    <Dialog
      title="画像の配置"
      onClose={() => answer(null)}
      footer={
        <>
          <button type="button" onClick={() => answer(null)}>
            キャンセル
          </button>
          <button type="button" onClick={() => answer({ choice: 'fit', remember })}>
            キャンバスに合わせる
          </button>
          <button type="button" className="primary" onClick={() => answer({ choice: 'original', remember })}>
            原寸で配置
          </button>
        </>
      }
    >
      <p>
        「{q.name}」（{q.width} × {q.height} px）はキャンバス（{q.canvasWidth} × {q.canvasHeight} px）より大きい画像です。
      </p>
      <ul className="placement-choices">
        <li>
          <b>原寸で配置</b>：{q.width} × {q.height} px のまま中央に置く。はみ出した部分は書き出されません（「画像」→「キャンバスを内容に合わせる」で広げられます）。
        </li>
        <li>
          <b>キャンバスに合わせる</b>：{fitW} × {fitH} px に縮めて置く。元の画素は残り、書き出しではバイキュービックで縮小します。
        </li>
      </ul>
      <Toggle checked={remember} onChange={setRemember}>
        次回から確認しない（「編集」→「環境設定…」で変更できます）
      </Toggle>
    </Dialog>
  );
}
