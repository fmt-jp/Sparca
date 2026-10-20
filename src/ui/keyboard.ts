/** Input types whose keystrokes are not text entry, so editor shortcuts stay active on them. */
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'color', 'button', 'submit', 'reset', 'file']);

/** Whether the event target consumes typed keys (text fields, sliders, selects, editable content). */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName === 'INPUT') return !NON_TEXT_INPUTS.has((target as HTMLInputElement).type);
  return false;
}
