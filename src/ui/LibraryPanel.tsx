// ライブラリ (2026-11-16): under the layers in the right column, as high as the user drags it
// (and folded down to its header on a click). Items show a real rendering of their settings;
// click applies to the selection (Shift: effects go after the current ones), drag onto an
// object applies to it, right-click for the rest. Kept in this browser; .hnbfx files carry it.
import { useMemo, useState, useSyncExternalStore, type ReactElement } from 'react';
import { createDocument, createShape } from '../model/factory';
import {
  describeItem,
  LIBRARY_EXTENSION,
  libraryFile,
  MAX_NAME_LENGTH,
  overwriteItem,
  PART_LABELS,
  type LibraryItem,
  type LibraryPart,
} from '../model/library';
import { DocumentSvg } from '../render/DocumentSvg';
import { isAbort, pickFiles, saveBlob } from '../io/files';
import { validateLibrary } from '../io/validate';
import {
  applyLibraryItem,
  duplicateItem,
  importItems,
  libraryItems,
  moveItem,
  registerItem,
  registerSource,
  removeItem,
  renameItem,
  subscribeLibrary,
  updateItem,
  type ImportChoice,
} from '../store/library';
import { ContextMenu } from './ContextMenu';
import { Dialog } from './Dialog';
import { Toggle } from './controls';
import type { MenuItem } from './MenuBar';
import { editor, useEditor } from './useEditor';

/** Drag data of a library item (its id). */
export const LIBRARY_MIME = 'application/x-hanabi-library';

const FILE_TYPE = { description: 'HANABI ライブラリ', accept: { 'application/json': [LIBRARY_EXTENSION] } };

export function useLibrary(): LibraryItem[] {
  return useSyncExternalStore(subscribeLibrary, libraryItems);
}

/** The item drawn on a rounded rectangle (gray when it has no fill of its own), as HANABI renders it. */
export function LibraryThumb({ item, size = 64 }: { item: LibraryItem; size?: number }): ReactElement {
  const doc = useMemo(() => {
    const d = createDocument(128, 104);
    d.background = { kind: 'transparent' };
    const s = createShape({ kind: 'rect', cornerRadius: 10 }, { x: 24, y: 26, width: 80, height: 52, rotation: 0 });
    s.fill = item.fill !== undefined ? item.fill : '#8b93a1';
    s.stroke = item.stroke ? item.stroke.paint : null;
    s.strokeWidth = item.stroke ? item.stroke.width : 0;
    if (item.stroke?.style) s.strokeStyle = item.stroke.style;
    if (item.stroke?.join) s.strokeJoin = item.stroke.join;
    s.effects = item.effects ? structuredClone(item.effects) : [];
    d.layers[0].children.push(s);
    return d;
  }, [item]);
  return (
    <span className="lib-thumb" style={{ width: size, height: (size * 104) / 128 }}>
      <DocumentSvg doc={doc} options={{ imageHref: () => undefined, idPrefix: `lib-${item.id}` }} width={size} height={(size * 104) / 128} />
    </span>
  );
}

type Dlg =
  | { kind: 'register' }
  | { kind: 'rename'; item: LibraryItem }
  | { kind: 'import'; file: string; items: LibraryItem[] }
  | null;

export function LibraryPanel({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const items = useLibrary();
  // Re-render when the selection changes (the ＋ button needs one object).
  useEditor((s) => s.selection);
  useEditor((s) => s.doc);
  const source = registerSource(editor);
  const [menu, setMenu] = useState<{ x: number; y: number; item: LibraryItem } | null>(null);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  async function exportItems(list: LibraryItem[], name: string) {
    try {
      const blob = new Blob([JSON.stringify(libraryFile(list), null, 2)], { type: 'application/json' });
      await saveBlob(blob, `${name}${LIBRARY_EXTENSION}`, FILE_TYPE);
    } catch (e) {
      if (!isAbort(e)) editor.notify('error', `エクスポートに失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function startImport() {
    const [file] = await pickFiles(`${LIBRARY_EXTENSION},application/json`);
    if (!file) return;
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      editor.notify('error', `「${file.name}」を読み込めませんでした（JSON ではありません）。`);
      return;
    }
    const r = validateLibrary(raw);
    if (!r.ok) {
      editor.notify('error', `「${file.name}」を読み込めませんでした: ${r.error}`);
      return;
    }
    if (!r.items.length) {
      editor.notify('info', `「${file.name}」にはライブラリの項目がありません。`);
      return;
    }
    setDlg({ kind: 'import', file: file.name, items: r.items });
  }

  function itemMenu(item: LibraryItem): MenuItem[] {
    const canOverwrite = !!source;
    return [
      { label: '選択中のオブジェクトに適用', action: () => applyLibraryItem(editor, item) },
      { label: '後ろに追加して適用', shortcut: 'Shift+クリック', disabled: !item.effects, action: () => applyLibraryItem(editor, item, true) },
      { separator: true, label: '' },
      {
        label: '選択中のオブジェクトで上書き',
        disabled: !canOverwrite,
        action: () => source && updateItem(editor, item.id, (i) => overwriteItem(i, source.object)),
      },
      { label: '名前の変更…', action: () => setDlg({ kind: 'rename', item }) },
      { label: '複製', action: () => duplicateItem(editor, item.id) },
      { separator: true, label: '' },
      { label: 'エクスポート…', action: () => void exportItems([item], item.name) },
      { separator: true, label: '' },
      {
        label: '削除',
        action: () => {
          if (window.confirm(`ライブラリの「${item.name}」を削除しますか？（適用済みのオブジェクトは変わりません）`)) removeItem(editor, item.id);
        },
      },
    ];
  }

  return (
    <section className="panel library-panel" aria-label="ライブラリ">
      <div className="panel-header library-header">
        <button type="button" className="library-toggle" aria-expanded={!collapsed} onClick={onToggle} title={collapsed ? 'ライブラリを開く' : 'ライブラリをたたむ'}>
          <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span> ライブラリ
          {items.length > 0 && <span className="library-count">{items.length}</span>}
        </button>
        <div className="panel-actions">
          <button
            type="button"
            title={source ? '選択中のオブジェクトのエフェクト・塗り・線を登録' : '登録するオブジェクトを 1 つ選択してください'}
            aria-label="ライブラリに登録"
            disabled={!source}
            onClick={() => setDlg({ kind: 'register' })}
          >
            <SmallSvg d="M8 3v10M3 8h10" />
          </button>
          <button type="button" title="ライブラリのインポート" aria-label="ライブラリのインポート" onClick={() => void startImport()}>
            <SmallSvg d="M8 2v8M5 7l3 3 3-3M3 13h10" />
          </button>
          <button
            type="button"
            title="ライブラリをすべてエクスポート"
            aria-label="ライブラリをすべてエクスポート"
            disabled={!items.length}
            onClick={() => void exportItems(items, 'HANABI-library')}
          >
            <SmallSvg d="M8 10V2M5 5l3-3 3 3M3 13h10" />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="library-grid" role="list" aria-label="ライブラリの項目">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="listitem"
              className={`lib-item${dragOver === item.id ? ' drop-before' : ''}`}
              data-library-item={item.name}
              title={`${item.name}\n${describeItem(item)}\nクリックで適用（置き換え）・Shift+クリックでエフェクトを後ろに追加・オブジェクトへドラッグでも適用`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(LIBRARY_MIME, item.id);
                e.dataTransfer.effectAllowed = 'copyMove';
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(LIBRARY_MIME)) return;
                e.preventDefault();
                setDragOver(item.id);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = e.dataTransfer.getData(LIBRARY_MIME);
                if (id) moveItem(editor, id, item.id);
              }}
              onClick={(e) => applyLibraryItem(editor, item, e.shiftKey)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, item });
              }}
            >
              <LibraryThumb item={item} />
              <span className="lib-name">{item.name}</span>
            </button>
          ))}
          {!items.length && (
            <div className="library-empty">
              （まだありません）
              <span className="hint explain">オブジェクトを選んで「＋」を押すと、そのエフェクト・塗り・線を登録できます。.hnbfx ファイルのインポートでも追加できます。</span>
            </div>
          )}
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} label={`「${menu.item.name}」のメニュー`} items={itemMenu(menu.item)} onClose={() => setMenu(null)} />}
      {dlg?.kind === 'register' && source && <RegisterDialog parts={source.parts} defaultName={source.object.name} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'rename' && <RenameDialog item={dlg.item} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'import' && <ImportDialog file={dlg.file} incoming={dlg.items} existing={items} onClose={() => setDlg(null)} />}
    </section>
  );
}

function SmallSvg({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function NameField({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter: () => void }) {
  return (
    <label className="field library-name-field">
      <span className="field-label">名前</span>
      <input
        type="text"
        aria-label="名前"
        value={value}
        maxLength={MAX_NAME_LENGTH}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter();
        }}
      />
    </label>
  );
}

function RegisterDialog({ parts, defaultName, onClose }: { parts: LibraryPart[]; defaultName: string; onClose: () => void }) {
  const [name, setName] = useState(defaultName);
  const [chosen, setChosen] = useState<LibraryPart[]>(parts);
  const ok = name.trim().length > 0 && chosen.length > 0;
  const submit = () => {
    if (!ok) return;
    if (registerItem(editor, name, chosen)) onClose();
  };
  return (
    <Dialog
      title="ライブラリに登録"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className="primary" disabled={!ok} onClick={submit}>
            登録
          </button>
        </>
      }
    >
      <NameField value={name} onChange={setName} onEnter={submit} />
      <div className="library-parts" role="group" aria-label="登録する設定">
        {(['effects', 'fill', 'stroke'] as const).map((p) => (
          <Toggle
            key={p}
            disabled={!parts.includes(p)}
            checked={chosen.includes(p)}
            onChange={(v) => setChosen((c) => (v ? [...c, p] : c.filter((x) => x !== p)))}
          >
            {PART_LABELS[p]}
          </Toggle>
        ))}
      </div>
      <div className="hint explain">選んだオブジェクトの設定をこのブラウザのライブラリに登録します。適用すると、チェックした設定だけが置き換わります（線はテキスト・画像には、塗りは画像にはありません）。</div>
    </Dialog>
  );
}

function RenameDialog({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const [name, setName] = useState(item.name);
  const submit = () => {
    if (!name.trim()) return;
    renameItem(editor, item.id, name);
    onClose();
  };
  return (
    <Dialog
      title="名前の変更"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className="primary" disabled={!name.trim()} onClick={submit}>
            OK
          </button>
        </>
      }
    >
      <NameField value={name} onChange={setName} onEnter={submit} />
    </Dialog>
  );
}

function ImportDialog({ file, incoming, existing, onClose }: { file: string; incoming: LibraryItem[]; existing: LibraryItem[]; onClose: () => void }) {
  const names = new Set(existing.map((i) => i.name));
  const [choices, setChoices] = useState<Record<number, ImportChoice>>({});
  const choiceOf = (i: number) => choices[i] ?? 'rename';
  const submit = () => {
    const n = importItems(editor, incoming, (item) => choiceOf(incoming.indexOf(item)));
    editor.notify('info', `ライブラリに ${n} 件を取り込みました。`);
    onClose();
  };
  return (
    <Dialog
      title="ライブラリのインポート"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className="primary" onClick={submit}>
            インポート
          </button>
        </>
      }
    >
      <div>
        「{file}」に {incoming.length} 件あります。
      </div>
      <table className="library-import">
        <thead>
          <tr>
            <th />
            <th>名前</th>
            <th>状態</th>
            <th>取り込み方</th>
          </tr>
        </thead>
        <tbody>
          {incoming.map((item, i) => {
            const clash = names.has(item.name);
            return (
              <tr key={i}>
                <td>
                  <LibraryThumb item={{ ...item, id: `import-${i}` }} size={36} />
                </td>
                <td>{item.name}</td>
                <td className={clash ? 'library-clash' : 'hint'}>{clash ? '同じ名前あり' : '新規'}</td>
                <td>
                  {clash ? (
                    <select aria-label={`「${item.name}」の取り込み方`} value={choiceOf(i)} onChange={(e) => setChoices((c) => ({ ...c, [i]: e.target.value as ImportChoice }))}>
                      <option value="rename">別名で追加</option>
                      <option value="replace">上書き</option>
                      <option value="skip">とばす</option>
                    </select>
                  ) : (
                    <span className="hint">追加</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="hint explain">取り込むのはこのブラウザのライブラリです。開いているプロジェクトは変わりません。</div>
    </Dialog>
  );
}

