// Open documents as tabs above the canvas.
import { openFile } from '../store/actions';
import { openDialog } from './dialogs';
import { editor, useEditor } from './useEditor';

export function closeTabWithConfirm(id: string): void {
  const tab = editor.getState().tabs.find((t) => t.id === id);
  if (!tab) return;
  if (tab.dirty && !window.confirm(`「${tab.fileName}」には保存していない変更があります。閉じますか？`)) return;
  editor.closeTab(id);
}

export function TabBar() {
  const tabs = useEditor((s) => s.tabs);
  const active = useEditor((s) => s.activeTabId);
  return (
    <div
      className="tabbar"
      role="tablist"
      aria-label="開いているドキュメント"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        // Files dropped on the tab bar open in new tabs (on the canvas they are placed instead).
        e.preventDefault();
        void (async () => {
          for (const f of [...e.dataTransfer.files]) await openFile(editor, f);
        })();
      }}
    >
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={`tab${t.id === active ? ' active' : ''}`}
          title={t.fileName}
          data-tab={t.fileName}
          onClick={() => editor.switchTab(t.id)}
          onAuxClick={(e) => {
            if (e.button === 1) closeTabWithConfirm(t.id);
          }}
        >
          <span className="tab-name">{t.fileName}</span>
          {t.dirty && (
            <span className="tab-dirty" aria-label="未保存">
              ●
            </span>
          )}
          <button
            type="button"
            className="tab-close"
            aria-label={`「${t.fileName}」を閉じる`}
            title="閉じる"
            onClick={(e) => {
              e.stopPropagation();
              closeTabWithConfirm(t.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="tab-new" aria-label="新規ドキュメント" title="新規ドキュメント" onClick={() => openDialog({ kind: 'new' })}>
        ＋
      </button>
    </div>
  );
}
