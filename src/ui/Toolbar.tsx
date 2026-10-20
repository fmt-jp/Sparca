import { useEffect, useRef, useState } from 'react';
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

  useEffect(() => {
    if (!openGroup) return;
    const close = () => setOpenGroup(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [openGroup]);

  return (
    <nav className="toolbar" aria-label="ツール">
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
