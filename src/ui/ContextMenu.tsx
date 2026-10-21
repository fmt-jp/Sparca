// Right-click menu (canvas): positioned at the pointer, keyboard navigable, one submenu level.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MenuItem } from './MenuBar';

export function ContextMenu({
  x,
  y,
  items,
  label,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  label: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, flipSub: false });

  // Keep the menu inside the window: flip left/up when it would overflow.
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    const left = x + r.width > window.innerWidth - 4 ? Math.max(4, x - r.width) : x;
    const top = y + r.height > window.innerHeight - 4 ? Math.max(4, window.innerHeight - 4 - r.height) : y;
    // Submenus open to the left when there is no room on the right.
    setPos({ left, top, flipSub: left + r.width * 2 > window.innerWidth - 4 });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onBlur = () => onClose();
    // Capture so a pointerdown elsewhere closes the menu before it is handled there.
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className={`menu-list context-menu${pos.flipSub ? ' flip-sub' : ''}`}
      role="menu"
      aria-label={label}
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItems items={items} onClose={onClose} autoFocus />
    </div>,
    document.body,
  );
}

function MenuItems({ items, onClose, autoFocus, onBack }: { items: MenuItem[]; onClose: () => void; autoFocus?: boolean; onBack?: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<number | null>(null);

  useEffect(() => {
    if (autoFocus) enabledItems(list.current)[0]?.focus();
  }, [autoFocus]);

  function onKeyDown(e: React.KeyboardEvent) {
    const all = enabledItems(list.current);
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    const move = (d: number) => all[(i + d + all.length) % all.length]?.focus();
    if (e.key === 'ArrowDown') move(1);
    else if (e.key === 'ArrowUp') move(-1);
    else if (e.key === 'Home') all[0]?.focus();
    else if (e.key === 'End') all[all.length - 1]?.focus();
    else if (e.key === 'Escape') {
      if (onBack) onBack();
      else onClose();
    } else if (e.key === 'ArrowLeft' && onBack) onBack();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  return (
    <div ref={list} className="context-menu-items" onKeyDown={onKeyDown}>
      {items.map((it, i) => {
        if (it.separator) return <hr key={i} />;
        if (it.children) {
          const open = sub === i;
          return (
            <div key={i} className="context-submenu" onPointerEnter={() => setSub(i)} onPointerLeave={() => setSub(null)}>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                data-sub={i}
                aria-expanded={open}
                className="menu-item"
                disabled={it.disabled}
                onClick={() => setSub(open ? null : i)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    setSub(i);
                  }
                }}
              >
                <span>{it.label}</span>
                <span aria-hidden="true">▸</span>
              </button>
              {open && (
                <SubMenu label={it.label}>
                  <MenuItems
                    items={it.children}
                    onClose={onClose}
                    autoFocus
                    onBack={() => {
                      setSub(null);
                      list.current?.querySelector<HTMLButtonElement>(`[data-sub="${i}"]`)?.focus();
                    }}
                  />
                </SubMenu>
              )}
            </div>
          );
        }
        return (
          <button
            key={i}
            type="button"
            role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={it.checked}
            className="menu-item"
            disabled={it.disabled}
            onPointerEnter={() => setSub(null)}
            onClick={() => {
              onClose();
              it.action?.();
            }}
          >
            <span>
              {it.checked !== undefined && <span className="check">{it.checked ? '✓' : ''}</span>}
              {it.label}
            </span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

/** Submenu box, moved up when it would run past the bottom of the window. */
function SubMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    const over = r.bottom - (window.innerHeight - 4);
    if (over > 0) setShift(-Math.min(over, r.top - 4));
  }, []);
  return (
    <div ref={ref} className="menu-list context-menu sub" role="menu" aria-label={label} style={shift ? { transform: `translateY(${shift}px)` } : undefined}>
      {children}
    </div>
  );
}

/** Enabled items of this level only (not those of an open submenu). */
function enabledItems(list: HTMLDivElement | null): HTMLButtonElement[] {
  if (!list) return [];
  return [...list.querySelectorAll<HTMLButtonElement>(':scope > button, :scope > .context-submenu > button')].filter((b) => !b.disabled);
}
