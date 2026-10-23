import { useSyncExternalStore } from 'react';

const KEY = 'sparca.panelSizes';

export interface PanelSizes {
  layersWidth: number;
  propsHeight: number;
  /** Temporarily hidden to give the canvas more room (sizes are kept for when shown again). */
  layersHidden: boolean;
  propsHidden: boolean;
}

const DEFAULTS: PanelSizes = { layersWidth: 260, propsHeight: 190, layersHidden: false, propsHidden: false };
export const LIMITS = { layersWidth: [180, 520], propsHeight: [80, 520] } as const;

function load(): PanelSizes {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PanelSizes> | null;
    return { ...DEFAULTS, ...(v ?? {}) };
  } catch {
    return DEFAULTS;
  }
}

// Shared by the layout, the toggle tabs and the 表示 menu; remembered per browser.
let current: PanelSizes = load();
const listeners = new Set<() => void>();

export function setPanelSizes(p: Partial<PanelSizes>): void {
  const next = { ...current, ...p };
  next.layersWidth = Math.min(LIMITS.layersWidth[1], Math.max(LIMITS.layersWidth[0], next.layersWidth));
  next.propsHeight = Math.min(LIMITS.propsHeight[1], Math.max(LIMITS.propsHeight[0], next.propsHeight));
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode etc.): sizes just aren't remembered.
  }
  listeners.forEach((l) => l());
}

export function getPanelSizes(): PanelSizes {
  return current;
}

/** F4 (as in Fireworks): hide both panels, or show both when either is hidden. */
export function togglePanels(): void {
  const hide = !current.layersHidden || !current.propsHidden;
  setPanelSizes({ layersHidden: hide, propsHidden: hide });
}

export function usePanelSizes(): [PanelSizes, (p: Partial<PanelSizes>) => void] {
  const sizes = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  return [sizes, setPanelSizes];
}

/** Pointer-drag helper for a splitter: reports the pointer delta from the drag start. */
export function startSplitterDrag(e: React.PointerEvent, onDelta: (dx: number, dy: number) => void): void {
  e.preventDefault();
  const x0 = e.clientX;
  const y0 = e.clientY;
  const move = (ev: PointerEvent) => onDelta(ev.clientX - x0, ev.clientY - y0);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
