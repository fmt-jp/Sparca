// マスクレイヤー (types.ts ObjectMask): add, edit (マスクの編集), switch off and remove the mask
// of the selected object.
import { groupObjects, updateObject } from '../model/commands';
import { newGradientMask, newMask, settleMask } from '../model/mask';
import { findObject, isEffectivelyLocked } from '../model/tree';
import type { Id, ObjectMask, SceneObject } from '../model/types';
import { reachOf } from '../render/DocumentSvg';
import type { EditorStore } from './editor';

/** The one selected, unlocked object (not inside a mask). */
function selectedObject(ed: EditorStore): SceneObject | null {
  const { doc, selection } = ed.getState();
  if (selection.length !== 1) return null;
  const loc = findObject(doc, selection[0]);
  return loc && !loc.maskOwner && !isEffectivelyLocked(loc) ? loc.object : null;
}

/** The object whose mask is being edited, if it still has one. */
export function maskOwner(ed: EditorStore): SceneObject | null {
  const { doc, maskEdit } = ed.getState();
  const o = maskEdit ? findObject(doc, maskEdit)?.object : null;
  return o?.mask ? o : null;
}

export function canAddMask(ed: EditorStore): boolean {
  const o = selectedObject(ed);
  return !!o && !o.mask;
}

export function canRemoveMask(ed: EditorStore): boolean {
  return !!(selectedObject(ed) ?? maskOwner(ed))?.mask;
}

function add(ed: EditorStore, mask: ObjectMask | null, id: Id, label: string): boolean {
  if (!mask) return false;
  ed.edit(label, (d) => updateObject(d, id, { mask } as Partial<SceneObject>));
  enterMaskEdit(ed, id);
  return true;
}

/**
 * Give the selected object (image, shape, path, text or group) an empty mask layer — white
 * (all shows; draw black to hide) or black (all hidden; draw white to show) — and start
 * editing it. One undo step.
 */
export function addMask(ed: EditorStore, background: 'white' | 'black'): boolean {
  const o = selectedObject(ed);
  if (!o) {
    ed.notify('error', 'マスクを付けるオブジェクトを 1 つ選択してください。');
    return false;
  }
  if (o.mask) return false;
  return add(ed, newMask(o, background), o.id, 'マスクの追加');
}

/** A mask layer holding a white-to-black gradient rectangle (左が見え、右へ消える). */
export function addGradientMask(ed: EditorStore): boolean {
  const o = selectedObject(ed);
  if (!o) {
    ed.notify('error', 'マスクを付けるオブジェクトを 1 つ選択してください。');
    return false;
  }
  if (o.mask) return false;
  return add(ed, newGradientMask(o, reachOf(o)), o.id, 'グラデーションマスクの追加');
}

/**
 * Start editing the mask of object `id`: drawing, pasting and selecting then work on the mask
 * content. The content is first placed against the object's current box (it is drawn there anyway).
 */
export function enterMaskEdit(ed: EditorStore, id: Id): void {
  const loc = findObject(ed.getState().doc, id);
  if (!loc?.object.mask || isEffectivelyLocked(loc)) return;
  const settled = settleMask(loc.object);
  if (settled !== loc.object.mask) ed.edit('マスクの編集', (d) => updateObject(d, id, { mask: settled } as Partial<SceneObject>));
  ed.select([]);
  ed.set({ maskEdit: id, tool: 'select' });
  // A mask with one thing in it (e.g. a gradient mask) has it selected, so its colors show at once.
  const children = findObject(ed.getState().doc, id)?.object.mask?.children ?? [];
  if (children.length === 1) ed.select([children[0].id]);
}

/** Stop editing the mask; the masked object is selected again. */
export function exitMaskEdit(ed: EditorStore): void {
  const id = ed.getState().maskEdit;
  if (!id) return;
  ed.set({ maskEdit: null });
  if (findObject(ed.getState().doc, id)) ed.select([id]);
}

/** Change the mask of object `id` (on/off, background, inverted). */
export function setMask(ed: EditorStore, id: Id, patch: Partial<Pick<ObjectMask, 'enabled' | 'background' | 'inverted'>>, label: string): void {
  const loc = findObject(ed.getState().doc, id);
  const mask = loc?.object.mask;
  if (!mask) return;
  ed.edit(label, (d) => updateObject(d, id, { mask: { ...mask, ...patch } } as Partial<SceneObject>));
}

/** Remove the mask of the selected object (or the one being edited): it shows in full again. One undo step. */
export function removeMask(ed: EditorStore): boolean {
  const o = maskOwner(ed) ?? selectedObject(ed);
  if (!o?.mask) return false;
  ed.set({ maskEdit: null });
  ed.edit('マスクの削除', (d) => {
    const loc = findObject(d, o.id);
    if (loc) delete loc.object.mask;
  });
  ed.select([o.id]);
  return true;
}

/**
 * リンク: whether the mask moves with object `id`. Unlinking leaves the content where it is on
 * the canvas (it no longer follows the object); linking again keeps it where it is now and
 * from then on it moves with the object. One undo step.
 */
export function setMaskLinked(ed: EditorStore, id: Id, linked: boolean): void {
  const loc = findObject(ed.getState().doc, id);
  const o = loc?.object;
  if (!o?.mask || (o.mask.linked !== false) === linked) return;
  const mask = settleMask(o)!;
  ed.edit(linked ? 'マスクのリンク' : 'マスクのリンク解除', (d) => {
    const t = findObject(d, id);
    if (!t) return;
    t.object.mask = { ...mask, linked, ...(o.type === 'group' ? {} : { frame: { ...(o as Exclude<SceneObject, { type: 'group' }>).box } }) };
  });
}

/** Whether 「グループでマスク」 can run: two or more unlocked objects side by side (same parent, not in a mask). */
export function canGroupAsMask(ed: EditorStore): boolean {
  return groupAsMaskInputs(ed) !== null;
}

function groupAsMaskInputs(ed: EditorStore): { top: Id; rest: Id[] } | null {
  const { doc, selection } = ed.getState();
  if (selection.length < 2) return null;
  const locs = selection.map((id) => findObject(doc, id));
  if (locs.some((l) => !l || l.maskOwner || isEffectivelyLocked(l))) return null;
  const parent = locs[0]!.siblings;
  if (locs.some((l) => l!.siblings !== parent)) return null;
  const sorted = [...locs].sort((a, b) => a!.index - b!.index);
  return { top: sorted[sorted.length - 1]!.object.id, rest: sorted.slice(0, -1).map((l) => l!.object.id) };
}

/**
 * グループでマスク (decided with the user 2026-11-05): the topmost of the selected objects
 * becomes the mask of the one below it — or, when there are several below, of a group made of
 * them (as Fireworks). It stays where it is on the canvas; an existing mask gets it added; a new
 * mask has a black background. One undo step; the masked object is selected.
 */
export function groupAsMask(ed: EditorStore): boolean {
  const input = groupAsMaskInputs(ed);
  if (!input) {
    ed.notify('error', 'グループでマスクには、同じ階層のオブジェクトを 2 つ以上選択してください（いちばん上がマスクになります）。');
    return false;
  }
  let targetId = input.rest[0];
  let done = false;
  ed.edit('グループでマスク', (d) => {
    if (input.rest.length > 1) targetId = groupObjects(d, input.rest) ?? targetId;
    const top = findObject(d, input.top);
    const target = findObject(d, targetId);
    if (!top || !target) return;
    const maskObj = top.object;
    top.siblings.splice(top.index, 1);
    const mask = settleMask(target.object) ?? newMask(target.object, 'black');
    if (!mask) return;
    target.object.mask = { ...mask, children: [...mask.children, maskObj] };
    done = true;
  });
  // As with the other ways of adding a mask: straight into マスクの編集, the new content selected.
  if (done) enterMaskEditWith(ed, targetId, [input.top]);
  else ed.select([targetId]);
  return true;
}

/**
 * Enter マスクの編集 of object `id` with `ids` (content just put into its mask) selected, so
 * its color, gradient and shape can be changed at once (2026-11-08, user's choice: every way
 * of adding a mask ends here).
 */
export function enterMaskEditWith(ed: EditorStore, id: Id, ids: Id[]): void {
  enterMaskEdit(ed, id);
  if (ed.getState().maskEdit !== id) return;
  const doc = ed.getState().doc;
  const present = ids.filter((c) => findObject(doc, c)?.maskOwner?.id === id);
  if (present.length) ed.select(present);
}
