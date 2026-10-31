// テキストをパスに添付 / パスから外す (decided with the user 2026-10-29: Fireworks-style — the
// text and the path become one text object, the path is not drawn, and detaching restores
// both). Shapes are turned into paths first; of a compound path the first outline is used.
import { removeObjects, updateObject } from '../model/commands';
import { newId } from '../model/factory';
import { canConvertToPath, shapeToPath } from '../model/shapeToPath';
import { findObject, isEffectivelyLocked } from '../model/tree';
import type { PathObject, SceneObject, TextObject, TextOnPath } from '../model/types';
import { fitTextBox } from '../render/text';
import type { EditorStore } from './editor';

/** The selected text and path (or shape) to attach, or null when the selection does not fit. */
function attachInputs(ed: EditorStore): { text: TextObject; path: PathObject } | null {
  const { doc, selection } = ed.getState();
  if (selection.length !== 2) return null;
  let text: TextObject | null = null;
  let path: PathObject | null = null;
  for (const id of selection) {
    const loc = findObject(doc, id);
    if (!loc || isEffectivelyLocked(loc)) return null;
    const o = loc.object;
    if (o.type === 'text' && !o.path && !text) text = o;
    else if (o.type === 'path' && o.nodes.length >= 2 && !path) path = o;
    else if (o.type === 'shape' && canConvertToPath(o.shape) && !path) path = shapeToPath(o);
    else return null;
  }
  return text && path ? { text, path } : null;
}

export function canAttachTextToPath(ed: EditorStore): boolean {
  return attachInputs(ed) !== null;
}

/** The selected text that runs along a path, if exactly that is selected. */
function selectedTextOnPath(ed: EditorStore): TextObject | null {
  const { doc, selection } = ed.getState();
  if (selection.length !== 1) return null;
  const loc = findObject(doc, selection[0]);
  if (!loc || isEffectivelyLocked(loc) || loc.object.type !== 'text' || !loc.object.path) return null;
  return loc.object;
}

export function canDetachTextFromPath(ed: EditorStore): boolean {
  return selectedTextOnPath(ed) !== null;
}

/**
 * Put the selected text on the selected path (or shape). The text takes the path's box and
 * outline (its first outline for a compound path) and stays where it is in the stacking
 * order; the path object goes away. It starts where its alignment says: the start, the
 * middle or the end of the path. One undo step.
 */
export function attachTextToPath(ed: EditorStore): boolean {
  const input = attachInputs(ed);
  if (!input) {
    ed.notify('error', 'テキスト 1 つと、パスまたは図形 1 つを選択してください。');
    return false;
  }
  const { text, path } = input;
  const onPath: TextOnPath = {
    nodes: path.nodes,
    closed: path.closed,
    offset: text.align === 'center' ? 0.5 : text.align === 'right' ? 1 : 0,
    orientation: 'rotate',
    reverse: false,
    shift: 0,
    source: {
      name: path.name,
      fill: path.fill,
      stroke: path.stroke,
      strokeWidth: path.strokeWidth,
      ...(path.strokeStyle ? { strokeStyle: path.strokeStyle } : {}),
      ...(path.strokeCap ? { strokeCap: path.strokeCap } : {}),
      ...(path.strokeJoin ? { strokeJoin: path.strokeJoin } : {}),
      opacity: path.opacity,
      effects: path.effects,
    },
  };
  ed.edit('テキストをパスに添付', (d) => {
    updateObject(d, text.id, { box: path.box, path: onPath } as Partial<SceneObject>);
    removeObjects(d, [path.id]);
  });
  ed.select([text.id]);
  return true;
}

/**
 * Take the selected text off its path: the path comes back as its own object (with its old
 * look) right under the text, and the text becomes normal text hanging from the top edge of
 * the path's box (at its left end, middle or right end, by its alignment). Both are selected. One undo step.
 */
export function detachTextFromPath(ed: EditorStore): boolean {
  const text = selectedTextOnPath(ed);
  if (!text?.path) return false;
  const tp = text.path;
  const path: PathObject = {
    id: newId(),
    name: tp.source.name,
    type: 'path',
    visible: true,
    locked: false,
    opacity: tp.source.opacity,
    effects: tp.source.effects,
    box: text.box,
    nodes: tp.nodes,
    closed: tp.closed,
    fill: tp.source.fill,
    stroke: tp.source.stroke,
    strokeWidth: tp.source.strokeWidth,
    ...(tp.source.strokeStyle ? { strokeStyle: tp.source.strokeStyle } : {}),
    ...(tp.source.strokeCap ? { strokeCap: tp.source.strokeCap } : {}),
    ...(tp.source.strokeJoin ? { strokeJoin: tp.source.strokeJoin } : {}),
  };
  const plain: TextObject = { ...text };
  delete plain.path;
  // The plain text hangs from the top edge of the path's box, at the point its alignment
  // uses (left end, middle or right end).
  const box = fitTextBox(plain);
  ed.edit('テキストをパスから外す', (d) => {
    const loc = findObject(d, text.id);
    if (!loc) return;
    loc.siblings[loc.index] = { ...plain, box };
    loc.siblings.splice(loc.index, 0, path);
  });
  ed.select([text.id, path.id]);
  return true;
}

/** Change how the selected text sits on its path (merging repeated slider steps by key). */
export function setTextPath(ed: EditorStore, id: string, patch: Partial<Omit<TextOnPath, 'nodes' | 'closed' | 'source'>>, label: string, mergeKey?: string): void {
  const loc = findObject(ed.getState().doc, id);
  if (!loc || loc.object.type !== 'text' || !loc.object.path) return;
  const path = { ...loc.object.path, ...patch };
  ed.edit(label, (d) => updateObject(d, id, { path } as Partial<SceneObject>), mergeKey ? `${mergeKey}:${id}` : null);
}
