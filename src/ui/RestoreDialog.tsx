// Shown at start when 自動保存 left work from a window that is gone (環境設定: 確認してから復元).
import { discardWork, restoreWork, type AutosaveRecord } from '../store/autosave';
import { Dialog } from './Dialog';
import { editor } from './useEditor';

const when = (ms: number) =>
  new Date(ms).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function RestoreDialog({ records, onClose }: { records: AutosaveRecord[]; onClose: () => void }) {
  return (
    <Dialog
      title="作業の復元"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} title="今は何もせず、次に開いたときにもう一度尋ねます">
            あとで
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              void discardWork(records);
            }}
          >
            破棄
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onClose();
              void restoreWork(editor, records).then((n) => n && editor.notify('info', `${n} 件の作業を復元しました。保存するまでは未保存です。`));
            }}
          >
            復元
          </button>
        </>
      }
    >
      <p>前回、保存していない作業が残っています。復元しますか？</p>
      <ul className="placement-choices" data-testid="restore-list">
        {records.map((r) => (
          <li key={r.key}>
            「{r.fileName}」（{when(r.savedAt)} の状態）
          </li>
        ))}
      </ul>
      <div className="hint">復元すると新しいタブに未保存として開きます（元のファイルには上書きせず、保存するときに保存先を尋ねます）。「破棄」すると元に戻せません。</div>
    </Dialog>
  );
}
