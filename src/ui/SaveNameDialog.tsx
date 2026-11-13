// 名前を付けて保存 where the browser has no save dialog (Firefox and others): the name is
// typed here and the file is downloaded under it.
import { useState } from 'react';
import type { SaveNameQuestion } from '../store/actions';
import { Dialog } from './Dialog';

export function SaveNameDialog({ question: q, answer }: { question: SaveNameQuestion; answer: (name: string | null) => void }) {
  const [name, setName] = useState(q.name);
  const ok = () => answer(name.trim() || q.name);
  return (
    <Dialog
      title="名前を付けて保存"
      onClose={() => answer(null)}
      footer={
        <>
          <button type="button" onClick={() => answer(null)}>
            キャンセル
          </button>
          <button type="button" className="primary" onClick={ok}>
            保存
          </button>
        </>
      }
    >
      <label className="save-name-row">
        ファイル名
        <input
          aria-label="ファイル名"
          value={name}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              ok();
            }
          }}
        />
        <span className="save-name-ext">{q.extension}</span>
      </label>
      <div className="hint">
        このブラウザでは、保存はダウンロードになります（ブラウザのダウンロード先に保存されます）。ファイルの上書きはできないため、保存するたびに新しいファイルになります。保存先を毎回選ぶには、ブラウザの設定で「ファイルごとに保存先を指定する」をオンにしてください。上書き保存は Chrome・Edge で使えます。
      </div>
    </Dialog>
  );
}
