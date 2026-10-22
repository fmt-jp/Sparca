// Font field: a button showing the current font in itself, opening a searchable list of
// the fonts on this PC (each shown in its own typeface).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  canListLocalFonts,
  cssFontFamily,
  detectedFonts,
  fontLabel,
  isFontAvailable,
  listLocalFonts,
  localFontsIfAllowed,
  localizeLocalFonts,
  type LocalFont,
  type FontEntry,
  type FontGroup,
} from '../render/fonts';

const GROUP_LABELS: Record<FontGroup, string> = {
  ja: '日本語',
  latin: '欧文',
  generic: '標準（どの PC でも使える）',
  local: 'この PC のすべてのフォント',
};
const PANEL_W = 320;
const PANEL_H = 380;

export function FontPicker({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const missing = !isFontAvailable(value);

  function toggle() {
    if (pos) {
      setPos(null);
      return;
    }
    const r = button.current!.getBoundingClientRect();
    const top = r.bottom + PANEL_H + 4 <= window.innerHeight ? r.bottom + 2 : Math.max(4, r.top - PANEL_H - 2);
    setPos({ left: Math.min(r.left, window.innerWidth - PANEL_W - 4), top });
  }

  return (
    <span className="font-picker">
      <button
        type="button"
        ref={button}
        className="font-button"
        aria-label="フォント"
        aria-haspopup="listbox"
        aria-expanded={!!pos}
        data-font={value}
        title={missing ? `「${value}」はこの PC にないため、代わりのフォントで表示しています` : fontLabel(value)}
        style={{ fontFamily: cssFontFamily(value) }}
        onClick={toggle}
      >
        {missing && <span className="font-missing" aria-hidden="true">⚠</span>}
        <span className="font-button-label">{fontLabel(value)}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {pos &&
        createPortal(
          <FontList
            pos={pos}
            value={value}
            anchor={button}
            onChoose={(f) => {
              setPos(null);
              button.current?.focus();
              if (f !== value) onChange(f);
            }}
            onClose={() => {
              setPos(null);
              button.current?.focus();
            }}
          />,
          document.body,
        )}
    </span>
  );
}

function FontList({
  pos,
  value,
  anchor,
  onChoose,
  onClose,
}: {
  pos: { left: number; top: number };
  value: string;
  anchor: React.RefObject<HTMLButtonElement | null>;
  onChoose: (family: string) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [local, setLocal] = useState<LocalFont[] | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  // -1 = not moved yet: highlight the current font.
  const [active, setActive] = useState(-1);
  const detected = useMemo(() => detectedFonts(), []);

  useEffect(() => {
    void localFontsIfAllowed().then((l) => {
      if (!l) return;
      setLocal(l);
      void localizeLocalFonts().then(setLocal);
    });
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [onClose, anchor]);

  const entries = useMemo(() => {
    const all: FontEntry[] = [...detected];
    if (local) {
      const known = new Set(detected.map((d) => d.family));
      for (const f of local) if (!known.has(f.family)) all.push({ family: f.family, label: f.label, group: 'local' });
    }
    // Keep the current font in the list even when this PC lacks it.
    if (!all.some((e) => e.family === value)) all.unshift({ family: value, label: fontLabel(value), group: 'ja' });
    const q = query.trim().toLowerCase();
    const hits = q ? all.filter((e) => e.label.toLowerCase().includes(q) || e.family.toLowerCase().includes(q)) : all;
    // A typed name not in the list can still be used (e.g. a font installed later).
    const exact = all.some((e) => e.family.toLowerCase() === q || e.label.toLowerCase() === q);
    const custom: FontEntry[] = q && !exact ? [{ family: query.trim(), label: `「${query.trim()}」を使う`, group: 'local' }] : [];
    return { custom, hits };
  }, [detected, local, query, value]);

  const flat = [...entries.custom, ...entries.hits];
  const act = Math.min(active < 0 ? Math.max(0, flat.findIndex((e) => e.family === value)) : active, flat.length - 1);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [act]);

  async function showAll() {
    setLocalError(null);
    try {
      setLocal(await listLocalFonts());
      setLocal(await localizeLocalFonts());
    } catch {
      setLocalError('フォント一覧を取得できませんでした（ブラウザで許可されていません）。');
    }
  }

  const option = (e: FontEntry, i: number, isCustom = false) => (
    <div
      key={`${isCustom ? 'custom:' : ''}${e.group}:${e.family}`}
      role="option"
      id={`font-opt-${i}`}
      aria-selected={e.family === value}
      data-active={i === act}
      data-family={e.family}
      title={!isCustom && e.label !== e.family ? `${e.label}（${e.family}）` : undefined}
      className={`font-option${i === act ? ' active' : ''}${e.family === value ? ' current' : ''}`}
      onPointerEnter={() => setActive(i)}
      onClick={() => onChoose(e.family)}
    >
      <span className="font-option-name" style={isCustom ? undefined : { fontFamily: cssFontFamily(e.family) }}>
        {!isCustom && !isFontAvailable(e.family) && <span className="font-missing">⚠ </span>}
        {e.label}
      </span>
      {!isCustom && (
        <span className="font-option-sample" style={{ fontFamily: cssFontFamily(e.family) }} aria-hidden="true">
          あア亜 Aa
        </span>
      )}
    </div>
  );

  let index = entries.custom.length;
  const groups: FontGroup[] = ['ja', 'latin', 'generic', 'local'];
  return (
    <div
      ref={panel}
      className="font-panel"
      role="dialog"
      aria-label="フォントの選択"
      style={{ left: pos.left, top: pos.top, width: PANEL_W, height: PANEL_H }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          setActive(Math.max(0, Math.min(flat.length - 1, act + (e.key === 'ArrowDown' ? 1 : -1))));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (flat[act]) onChoose(flat[act].family);
        }
      }}
    >
      <input
        className="font-search"
        aria-label="フォントを検索"
        placeholder="フォント名で検索（一覧にない名前も入力できます）"
        value={query}
        autoFocus
        spellCheck={false}
        aria-controls="font-listbox"
        aria-activedescendant={flat.length ? `font-opt-${act}` : undefined}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
      />
      <div className="font-listbox" role="listbox" id="font-listbox" aria-label="フォント一覧" ref={listRef}>
        {entries.custom.map((e, i) => option(e, i, true))}
        {groups.map((g) => {
          const items = entries.hits.filter((e) => e.group === g);
          if (!items.length) return null;
          return (
            <div key={g} role="group" aria-label={GROUP_LABELS[g]}>
              <div className="font-group-label">{GROUP_LABELS[g]}</div>
              {items.map((e) => option(e, index++))}
            </div>
          );
        })}
        {!flat.length && <div className="hint">見つかりません</div>}
      </div>
      {canListLocalFonts() && !local && (
        <div className="font-local">
          <button type="button" onClick={() => void showAll()}>
            この PC のすべてのフォントを表示…
          </button>
          {localError ? <span className="hint">{localError}</span> : <span className="hint">初回はブラウザが許可を求めます</span>}
        </div>
      )}
    </div>
  );
}
