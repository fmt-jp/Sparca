import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ToolId } from '../store/editor';
import { ToolIcon } from './icons';
import { TOOL_GROUPS, type ToolGroup } from './tools';
import { editor, useEditor } from './useEditor';

const LONG_PRESS_MS = 350;

/** Remembers the last-used tool of each group, shown as the group's button. */
const lastInGroup = new Map<string, ToolId>();

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!openGroup) return;
    const close = () => setOpenGroup(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [openGroup]);

  const twoCol = useTwoColumns(ref);

  return (
    <nav ref={ref} className={`toolbar${twoCol ? ' two-col' : ''}`} aria-label="ツール" data-columns={twoCol ? 2 : 1}>
      {TOOL_GROUPS.map((g) => (
        <GroupButton
          key={g.id}
          group={g}
          current={tool}
          open={openGroup === g.id}
          onOpen={() => setOpenGroup(g.id)}
          onClose={() => setOpenGroup(null)}
        />
      ))}
    </nav>
  );
}

function GroupButton({
  group,
  current,
  open,
  onOpen,
  onClose,
}: {
  group: ToolGroup;
  current: ToolId;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const active = group.tools.find((t) => t.id === current);
  if (active) lastInGroup.set(group.id, active.id);
  const shownId = active?.id ?? lastInGroup.get(group.id) ?? group.tools[0].id;
  const shown = group.tools.find((t) => t.id === shownId)!;
  const timer = useRef<number | undefined>(undefined);
  const multi = group.tools.length > 1;
  const tip = `${shown.label}${shown.key ? `（${shown.key}）` : ''}${multi ? ' — 長押しで切り替え' : ''}`;

  return (
    <div className="tool-group">
      <button
        type="button"
        className={`tool-button${active ? ' active' : ''}`}
        data-tool={shown.id}
        title={tip}
        aria-label={shown.label}
        aria-pressed={!!active}
        onPointerDown={(e) => {
          if (!multi) return;
          e.stopPropagation();
          timer.current = window.setTimeout(() => {
            timer.current = undefined;
            onOpen();
          }, LONG_PRESS_MS);
        }}
        onPointerUp={() => {
          if (timer.current !== undefined) {
            clearTimeout(timer.current);
            timer.current = undefined;
          }
        }}
        onClick={() => {
          if (!open) editor.setTool(shown.id);
        }}
        onContextMenu={(e) => {
          if (!multi) return;
          e.preventDefault();
          onOpen();
        }}
      >
        <ToolIcon name={shown.id} />
        {multi && <span className="group-mark" aria-hidden="true" />}
      </button>
      {open && (
        <div className="tool-flyout" role="menu" onPointerDown={(e) => e.stopPropagation()}>
          {group.tools.map((t) => (
            <button
              type="button"
              key={t.id}
              role="menuitem"
              className={`flyout-item${t.id === current ? ' active' : ''}`}
              data-tool={t.id}
              onClick={() => {
                editor.setTool(t.id);
                onClose();
              }}
            >
              <ToolIcon name={t.id} />
              <span>{t.label}</span>
              {t.key && <kbd>{t.key}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Two columns when one column of tools does not fit the window's height (decided with the user
 * 2026-11-09). Switches back once the height one column needed is available again.
 */
function useTwoColumns(ref: React.RefObject<HTMLElement | null>): boolean {
  const [two, setTwo] = useState(false);
  const need = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      if (!el.classList.contains('two-col')) {
        need.current = el.scrollHeight;
        setTwo(el.scrollHeight > el.clientHeight + 1);
      } else setTwo(el.clientHeight < need.current);
    };
    check();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    ro?.observe(el);
    window.addEventListener('resize', check);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [ref]);
  // The layout's tools column (App grid, splitter, panel toggle) follows the toolbar's width.
  useEffect(() => {
    document.documentElement.style.setProperty('--tools-w', two ? '84px' : '48px');
  }, [two]);
  return two;
}
