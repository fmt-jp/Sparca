// 変更 → マスクを追加…: a white mask (everything shows; paint black to hide) or a black one
// (everything hidden; paint white to show).
import { addMask } from '../store/maskActions';
import { Dialog } from './Dialog';
import { editor } from './useEditor';

export function AddMaskDialog({ onClose }: { onClose: () => void }) {
  const add = (bg: 'white' | 'black') => {
    onClose();
    addMask(editor, bg);
  };
  return (
    <Dialog
      title="マスクを追加"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" onClick={() => add('black')}>
            黒（全体を隠す）
          </button>
          <button type="button" className="primary" onClick={() => add('white')}>
            白（全体を表示）
          </button>
        </>
      }
    >
      <p>マスクの初めの色を選んでください。マスクの明るいところが表示され、暗いところが隠れます。</p>
      <ul className="placement-choices">
        <li>
          <b>白（全体を表示）</b>：はじめは全体が見え、黒い図形などを描いた部分が隠れる。
        </li>
        <li>
          <b>黒（全体を隠す）</b>：はじめは全体が隠れ、白い図形などを描いた部分が見える。
        </li>
      </ul>
    </Dialog>
  );
}
