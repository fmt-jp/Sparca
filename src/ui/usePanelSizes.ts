import { useCallback, useState } from 'react';

const KEY = 'sparca.panelSizes';

export interface PanelSizes {
  layersWidth: number;
  propsHeight: number;
}

const DEFAULTS: PanelSizes = { layersWidth: 260, propsHeight: 190 };
export const LIMITS = { layersWidth: [180, 520], propsHeight: [80, 520] } as const;

function load(): PanelSizes {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PanelSizes> | null;
    return { ...DEFAULTS, ...(v ?? {}) };
  } catch {
    return DEFAULTS;
  }
}

/** Panel sizes, remembered per browser (a viewer convenience only). */
export function usePanelSizes(): [PanelSizes, (p: Partial<PanelSizes>) => void] {
  const [sizes, setSizes] = useState(load);
  const update = useCallback((p: Partial<PanelSizes>) => {
    setSizes((prev) => {
      const next = { ...prev, ...p };
      next.layersWidth = Math.min(LIMITS.layersWidth[1], Math.max(LIMITS.layersWidth[0], next.layersWidth));
      next.propsHeight = Math.min(LIMITS.propsHeight[1], Math.max(LIMITS.propsHeight[0], next.propsHeight));
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable (private mode etc.): sizes just aren't remembered.
      }
      return next;
    });
  }, []);
  return [sizes, update];
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
