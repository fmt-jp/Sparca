// グラデーションマスク (types.ts ObjectMask): add, change and remove the mask of the selected object.
import { updateObject } from '../model/commands';
import { newGradientMask } from '../model/mask';
import { findObject, isEffectivelyLocked } from '../model/tree';
import type { ObjectMask, SceneObject } from '../model/types';
import type { EditorStore } from './editor';

/** The one selected, unlocked object. */
function selectedObject(ed: EditorStore): SceneObject | null {
  const { doc, selection } = ed.getState();
  if (selection.length !== 1) return null;
  const loc = findObject(doc, selection[0]);
  return loc && !isEffectivelyLocked(loc) ? loc.object : null;
}

export function canAddMask(ed: EditorStore): boolean {
  const o = selectedObject(ed);
  return !!o && !o.mask;
}

export function canRemoveMask(ed: EditorStore): boolean {
  return !!selectedObject(ed)?.mask;
}

/**
 * Give the selected object (image, shape, path, text or group) a gradient mask: white on the
 * left fading to black on the right. The canvas then shows the mask's handles. One undo step.
 */
export function addGradientMask(ed: EditorStore): boolean {
  const o = selectedObject(ed);
  if (!o) {
    ed.notify('error', 'マスクを付けるオブジェクトを 1 つ選択してください。');
    return false;
  }
  if (o.mask) return false;
  const mask = newGradientMask(o);
  if (!mask) return false;
  ed.edit('グラデーションマスクの追加', (d) => updateObject(d, o.id, { mask } as Partial<SceneObject>));
  ed.set({ gradientTarget: 'mask' });
  return true;
}

/** Change the selected object's mask (merging repeated slider steps by key). */
export function setMask(ed: EditorStore, id: string, patch: Partial<ObjectMask>, label: string, mergeKey?: string): void {
  const loc = findObject(ed.getState().doc, id);
  const mask = loc?.object.mask;
  if (!mask) return;
  ed.edit(label, (d) => updateObject(d, id, { mask: { ...mask, ...patch } } as Partial<SceneObject>), mergeKey ? `${mergeKey}:${id}` : null);
  ed.set({ gradientTarget: 'mask' });
}

/** Remove the selected object's mask (the object shows in full again). One undo step. */
export function removeMask(ed: EditorStore): boolean {
  const o = selectedObject(ed);
  if (!o?.mask) return false;
  ed.edit('マスクの削除', (d) => {
    const loc = findObject(d, o.id);
    if (loc) delete loc.object.mask;
  });
  if (ed.getState().gradientTarget === 'mask') ed.set({ gradientTarget: 'fill' });
  return true;
}
