import { useState } from 'react';
import {
  duplicateLayer,
  moveLayerNextTo,
  moveObjectAbove,
  moveObjectBelow,
  moveObjectToLayer,
  removeLayer,
  updateLayer,
  updateObject,
} from '../model/commands';
import type { Id, Layer, SceneObject } from '../model/types';
import { newLayer } from '../store/actions';
import { ICON, SmallIcon } from './icons';
import { editor, useEditor } from './useEditor';

type DragItem = { kind: 'layer'; id: Id } | { kind: 'object'; id: Id };

/**
 * Where a dragged item will go: the line above ('before') or below ('after') a row, as in
 * most layer panels. `id` is the row's layer or object id.
 */
type DropPos = { id: Id; pos: 'before' | 'after' };

/** Upper or lower half of the row under the pointer. */
function halfOf(e: React.DragEvent): 'before' | 'after' {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
}

function dropClass(drop: DropPos | null, id: Id): string {
  return drop?.id === id ? ` drop-${drop.pos}` : '';
}

const TYPE_LABEL: Record<SceneObject['type'], string> = {
  shape: '図形',
  path: 'パス',
  text: 'テキスト',
  image: '画像',
  group: 'グループ',
};

export function LayersPanel() {
  const doc = useEditor((s) => s.doc);
  const activeLayerId = useEditor((s) => s.activeLayerId);
  const selection = useEditor((s) => s.selection);
  const [collapsed, setCollapsed] = useState<Set<Id>>(new Set());
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropPos | null>(null);

  const layersTopFirst = [...doc.layers].reverse();

  function toggleCollapsed(id: Id) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  }

  /**
   * Drop on a layer's header row. A layer goes above / below that layer. An object dropped
   * on the lower half goes to the top of that layer (just under its header); on the upper
   * half, to the bottom of the layer listed above it (the line between the two layers), or
   * to the top of the topmost layer.
   */
  function dropOnLayer(layer: Layer, layerIndex: number, pos: 'before' | 'after') {
    if (!drag) return;
    if (drag.kind === 'layer') {
      if (drag.id !== layer.id) editor.edit('レイヤーの並べ替え', (d) => moveLayerNextTo(d, drag.id, layer.id, pos === 'before'));
      return;
    }
    const id = drag.id;
    const above = pos === 'before' ? doc.layers[layerIndex + 1] : undefined;
    const target = above ?? layer;
    editor.edit('オブジェクトの移動', (d) => moveObjectToLayer(d, id, target.id, above ? 0 : undefined));
    editor.set({ activeLayerId: target.id });
  }

  /** Drop on an object row: just above or below that object, in its layer. */
  function dropOnObject(layer: Layer, targetId: Id, pos: 'before' | 'after') {
    if (!drag || drag.kind !== 'object' || drag.id === targetId) return;
    const id = drag.id;
    editor.edit('重ね順の変更', (d) => (pos === 'before' ? moveObjectAbove(d, id, targetId) : moveObjectBelow(d, id, targetId)));
    editor.set({ activeLayerId: layer.id });
  }

  return (
    <aside className="panel layers-panel" aria-label="レイヤー">
      <div className="panel-header">
        <span>レイヤー</span>
        <div className="panel-actions">
          <button type="button" title="新規レイヤー" aria-label="新規レイヤー" onClick={() => newLayer(editor)}>
            <SmallIcon d={ICON.plus} />
          </button>
          <button
            type="button"
            title="レイヤーを複製"
            aria-label="レイヤーを複製"
            onClick={() => {
              let id = '';
              editor.edit('レイヤーの複製', (d) => {
                id = duplicateLayer(d, activeLayerId)?.id ?? '';
              });
              if (id) editor.set({ activeLayerId: id });
            }}
          >
            <SmallIcon d={ICON.copy} />
          </button>
          <button
            type="button"
            title="レイヤーを削除"
            aria-label="レイヤーを削除"
            disabled={doc.layers.length <= 1}
            onClick={() => {
              const layer = doc.layers.find((l) => l.id === activeLayerId);
              if (!layer) return;
              if (layer.children.length && !window.confirm(`レイヤー「${layer.name}」と中のオブジェクト ${layer.children.length} 個を削除しますか？`)) return;
              editor.edit('レイヤーの削除', (d) => {
                removeLayer(d, activeLayerId);
              });
            }}
          >
            <SmallIcon d={ICON.trash} />
          </button>
        </div>
      </div>
      <ul className="layer-list" role="tree">
        {layersTopFirst.map((layer) => {
          const layerIndex = doc.layers.indexOf(layer);
          const isActive = layer.id === activeLayerId;
          return (
            <li key={layer.id} role="treeitem" aria-expanded={!collapsed.has(layer.id)}>
              <div
                className={`layer-row${isActive ? ' active' : ''}${dropClass(dropTarget, layer.id)}`}
                data-layer-row={layer.name}
                draggable
                onDragStart={(e) => {
                  setDrag({ kind: 'layer', id: layer.id });
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', layer.name);
                }}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  const pos = halfOf(e);
                  if (dropTarget?.id !== layer.id || dropTarget.pos !== pos) setDropTarget({ id: layer.id, pos });
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  dropOnLayer(layer, layerIndex, halfOf(e));
                  setDrag(null);
                  setDropTarget(null);
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setDropTarget(null);
                }}
                onClick={() => editor.set({ activeLayerId: layer.id })}
              >
                <button
                  type="button"
                  className="twisty"
                  aria-label={collapsed.has(layer.id) ? '展開' : '折りたたむ'}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCollapsed(layer.id);
                  }}
                >
                  <SmallIcon d={collapsed.has(layer.id) ? ICON.chevronRight : ICON.chevronDown} />
                </button>
                <VisibilityToggle
                  visible={layer.visible}
                  onToggle={() => editor.edit('表示の切り替え', (d) => updateLayer(d, layer.id, { visible: !layer.visible }))}
                />
                <LockToggle
                  locked={layer.locked}
                  onToggle={() => editor.edit('ロックの切り替え', (d) => updateLayer(d, layer.id, { locked: !layer.locked }))}
                />
                <EditableName
                  name={layer.name}
                  className="layer-name"
                  onRename={(name) => editor.edit('名前の変更', (d) => updateLayer(d, layer.id, { name }))}
                />
              </div>
              {!collapsed.has(layer.id) && (
                <ObjectList
                  objects={layer.children}
                  layer={layer}
                  depth={1}
                  selection={selection}
                  onDragStart={(id) => setDrag({ kind: 'object', id })}
                  onDrop={(targetId, pos) => {
                    dropOnObject(layer, targetId, pos);
                    setDrag(null);
                    setDropTarget(null);
                  }}
                  dragging={drag?.kind === 'object'}
                  dropTarget={dropTarget}
                  setDropTarget={setDropTarget}
                />
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function ObjectList(props: {
  objects: SceneObject[];
  layer: Layer;
  depth: number;
  selection: Id[];
  onDragStart: (id: Id) => void;
  onDrop: (targetId: Id, pos: 'before' | 'after') => void;
  dragging: boolean;
  dropTarget: DropPos | null;
  setDropTarget: (d: DropPos | null) => void;
}) {
  const { objects, layer, depth, selection } = props;
  const topFirst = [...objects].reverse();
  return (
    <ul role="group">
      {topFirst.map((o) => (
        <li key={o.id} role="treeitem">
          <div
            className={`object-row${selection.includes(o.id) ? ' selected' : ''}${dropClass(props.dropTarget, o.id)}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            data-object-row={o.name}
            draggable={depth === 1}
            onDragStart={(e) => {
              e.stopPropagation();
              props.onDragStart(o.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', o.name);
            }}
            onDragOver={(e) => {
              if (!props.dragging || depth !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              const pos = halfOf(e);
              if (props.dropTarget?.id !== o.id || props.dropTarget.pos !== pos) props.setDropTarget({ id: o.id, pos });
            }}
            onDrop={(e) => {
              if (depth !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              props.onDrop(o.id, halfOf(e));
            }}
            onClick={(e) => {
              e.stopPropagation();
              editor.set({ activeLayerId: layer.id });
              if (depth > 1) return;
              const sel = editor.getState().selection;
              if (e.shiftKey || e.metaKey || e.ctrlKey) {
                editor.select(sel.includes(o.id) ? sel.filter((s) => s !== o.id) : [...sel, o.id]);
              } else editor.select([o.id]);
            }}
          >
            <VisibilityToggle
              visible={o.visible}
              onToggle={() => editor.edit('表示の切り替え', (d) => updateObject(d, o.id, { visible: !o.visible }))}
            />
            <LockToggle
              locked={o.locked}
              onToggle={() => editor.edit('ロックの切り替え', (d) => updateObject(d, o.id, { locked: !o.locked }))}
            />
            <span className="type-badge">{TYPE_LABEL[o.type]}</span>
            <EditableName
              name={o.name}
              className="object-name"
              onRename={(name) => editor.edit('名前の変更', (d) => updateObject(d, o.id, { name }))}
            />
          </div>
          {o.type === 'group' && <ObjectList {...props} objects={o.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function VisibilityToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`row-toggle${visible ? '' : ' off'}`}
      title={visible ? '非表示にする' : '表示する'}
      aria-label={visible ? '非表示にする' : '表示する'}
      aria-pressed={!visible}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <SmallIcon d={visible ? ICON.eye : ICON.eyeOff} />
    </button>
  );
}

function LockToggle({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`row-toggle${locked ? ' on' : ' dim'}`}
      title={locked ? 'ロックを解除' : 'ロックする'}
      aria-label={locked ? 'ロックを解除' : 'ロックする'}
      aria-pressed={locked}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <SmallIcon d={locked ? ICON.lock : ICON.unlock} />
    </button>
  );
}

function EditableName({ name, className, onRename }: { name: string; className: string; onRename: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        className="name-input"
        defaultValue={name}
        autoFocus
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== name) onRename(v);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <span className={className} title="ダブルクリックで名前を変更" onDoubleClick={() => setEditing(true)}>
      {name}
    </span>
  );
}
