// テキストのアウトライン化 (decided with the user 2026-11-14): each selected text becomes one
// (compound) path of its letters that looks the same — its color (gradient, pattern), effects,
// opacity, mask, name and id carry over — so it can be edited as a path and combined
// (パスの結合). One undo step. The outlines come from render/textOutline (loaded on demand).
import { loadTextOutline } from '../lazy';
import { settleMask } from '../model/mask';
import { docContoursToPath } from '../model/pathEdit';
import { findObject, isEffectivelyLocked } from '../model/tree';
import type { Box, PathObject, TextObject } from '../model/types';
import type { EditorStore } from './editor';
import { refitFill } from './pathCombine';

const NO_ROTATION: Box = { x: 0, y: 0, width: 1, height: 1, rotation: 0 };

/** The selected texts that can be outlined (unlocked). */
function selectedTexts(ed: EditorStore): TextObject[] {
  const { doc, selection } = ed.getState();
  return selection
    .map((id) => findObject(doc, id))
    .filter((l) => l && l.object.type === 'text' && !isEffectivelyLocked(l))
    .map((l) => l!.object as TextObject);
}

export function canOutlineText(ed: EditorStore): boolean {
  return selectedTexts(ed).length > 0;
}

/** Outline the selected texts. Returns how many became paths. */
export async function outlineSelectedText(ed: EditorStore): Promise<number> {
  const texts = selectedTexts(ed);
  if (!texts.length) {
    ed.notify('error', 'アウトライン化するテキストを選択してください。');
    return 0;
  }
  const doc = ed.getState().doc;
  ed.set({ busy: 'テキストをアウトライン化しています…' });
  try {
    const { outlineText } = await loadTextOutline();
    const results: PathObject[] = [];
    let traced = false;
    for (const o of texts) {
      const r = await outlineText(o, doc);
      if (!r.contours.length) continue;
      traced ||= r.traced;
      const geometry = docContoursToPath(NO_ROTATION, r.contours);
      const path: PathObject = {
        id: o.id,
        name: o.name,
        type: 'path',
        visible: o.visible,
        locked: false,
        opacity: o.opacity,
        effects: o.effects,
        fill: refitFill(o.color, o.box, geometry.box),
        stroke: null,
        strokeWidth: 0,
        ...(o.mask ? { mask: { ...settleMask(o)!, frame: geometry.box } } : {}),
        ...geometry,
      };
      if (!path.subpaths) delete path.subpaths;
      results.push(path);
    }
    if (!results.length) {
      ed.notify('error', 'アウトライン化できる文字がありません（空白だけのテキストです）。');
      return 0;
    }
    // The document may have changed while the outlines were made: replace only what is still there.
    ed.edit('テキストのアウトライン化', (d) => {
      for (const p of results) {
        const loc = findObject(d, p.id);
        if (loc?.object.type === 'text') loc.siblings[loc.index] = p;
      }
    });
    ed.select(results.map((p) => p.id));
    if (traced) {
      ed.notify(
        'info',
        'フォントファイルを読めないフォント（または書体）のため、文字の形をなぞってアウトライン化しました（輪郭はわずかに近似です）。Chrome・Edge で PC にあるフォントを使うと、フォントの正確な輪郭になります。',
      );
    }
    return results.length;
  } catch (e) {
    ed.notify('error', `アウトライン化に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  } finally {
    ed.set({ busy: null });
  }
}
