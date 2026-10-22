import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Dialog({
  title,
  children,
  onClose,
  footer,
  clearBackdrop,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer: ReactNode;
  /** Don't darken the page (for dialogs that preview colors on the canvas). */
  clearBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Dragging the title moves the dialog (e.g. off the object being previewed).
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  function startMove(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX - offset.x;
    const sy = e.clientY - offset.y;
    const move = (ev: PointerEvent) => setOffset({ x: ev.clientX - sx, y: ev.clientY - sy });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div className={`dialog-backdrop${clearBackdrop ? ' clear' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        style={offset.x || offset.y ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <h2 className="dialog-title" title="ドラッグで移動" onPointerDown={startMove}>
          {title}
        </h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-footer">{footer}</div>
      </div>
    </div>
  );
}
