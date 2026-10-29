// Menu entry point for 「パスの結合」: loads the boolean geometry (paper.js) and runs it.
import { AppUpdatedError, loadPathBoolean } from '../lazy';
import { COMBINE_LABELS, combineSelection, type CombineOp } from '../store/pathCombine';
import { editor } from './useEditor';

export const COMBINE_OPS: CombineOp[] = ['unite', 'subtract', 'intersect', 'exclude'];

export async function runCombine(op: CombineOp): Promise<void> {
  try {
    const { booleanContours } = await loadPathBoolean();
    combineSelection(editor, op, booleanContours);
  } catch (e) {
    editor.notify(
      'error',
      e instanceof AppUpdatedError ? e.message : `パスの${COMBINE_LABELS[op]}に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
