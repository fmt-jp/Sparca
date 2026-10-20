import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addObject, removeObjects, updateObject } from '../model/commands';
import { createShape, createText, defaultGeometry } from '../model/factory';
import { boxCenter, boxCorners, unionBounds, transformObject, rectsIntersect, objectBounds, type Rect } from '../model/geometry';
import {
  angleTo,
  boundsResize,
  dragRect,
  HANDLES,
  handleFraction,
  handlePoint,
  resizeBox,
  snap45,
  snapAngle,
  type Handle,
} from '../model/handles';
import { findObject, isEffectivelyLocked } from '../model/tree';
import type { Box, Id, Point, SceneObject, ShapeGeometry, SparcaDocument, TextObject } from '../model/types';
import { DocumentSvg } from '../render/DocumentSvg';
import { imageCache } from '../render/imageCache';
import { measureText } from '../render/text';
import { placeImageFiles, writableLayer } from '../store/actions';
import type { ToolId } from '../store/editor';
import { editor, useEditor } from './useEditor';

const PAD = 400; // workspace margin around the canvas, in screen px
export const ZOOM_STEPS = [0.0625, 0.125, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];

const SHAPE_TOOLS: Partial<Record<ToolId, ShapeGeometry['kind']>> = {
  rect: 'rect',
  'rounded-rect': 'rect',
  ellipse: 'ellipse',
  polygon: 'polygon',
  star: 'star',
  line: 'line',
  arrow: 'arrow',
};

type Gesture =
  | { kind: 'move'; start: Point; originals: Map<Id, SceneObject>; moved: boolean }
  | { kind: 'resize'; handle: Handle; originals: Map<Id, SceneObject>; single: Box | null; bounds: Rect }
  | { kind: 'rotate'; center: Point; startAngle: number; originals: Map<Id, SceneObject> }
  | { kind: 'marquee'; start: Point; current: Point; additive: boolean; base: Id[] }
  | { kind: 'create'; tool: ToolId; start: Point; current: Point; id: Id | null }
  | { kind: 'pan'; startClient: Point; startScroll: Point };

export function CanvasView() {
  const doc = useEditor((s) => s.doc);
  const zoom = useEditor((s) => s.zoom);
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const [, forceRender] = useState(0);
  useEffect(() => imageCache.subscribe(() => forceRender((n) => n + 1)), []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [editingText, setEditingText] = useState<{ id: Id; isNew: boolean } | null>(null);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);

  const effectiveTool: ToolId = spaceDown ? 'hand' : tool;

  /** Screen → document coordinates. */
  const toDoc = useCallback(
    (clientX: number, clientY: number): Point => {
      const r = stageRef.current!.getBoundingClientRect();
      return { x: (clientX - r.left - PAD) / zoom, y: (clientY - r.top - PAD) / zoom };
    },
    [zoom],
  );

  // Center the canvas on first render and whenever the document size changes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.width, doc.height]);

  // Keep the point under the cursor fixed when zooming via setZoomAt.
  const zoomAnchor = useRef<{ doc: Point; client: Point } | null>(null);
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const el = scrollRef.current;
    if (!a || !el || !stageRef.current) return;
    zoomAnchor.current = null;
    const r = stageRef.current.getBoundingClientRect();
    const sx = r.left + PAD + a.doc.x * zoom;
    const sy = r.top + PAD + a.doc.y * zoom;
    el.scrollLeft += sx - a.client.x;
    el.scrollTop += sy - a.client.y;
  }, [zoom]);

  const setZoomAt = useCallback(
    (next: number, clientX: number, clientY: number) => {
      const z = Math.min(32, Math.max(0.0625, next));
      zoomAnchor.current = { doc: toDoc(clientX, clientY), client: { x: clientX, y: clientY } };
      editor.set({ zoom: z });
    },
    [toDoc],
  );

  // Space = temporary hand tool.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e) && !e.repeat) {
        setSpaceDown(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Ctrl/Cmd + wheel zooms around the cursor.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const z = editor.getState().zoom;
      setZoomAt(z * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoomAt]);

  const selectedObjects = selection
    .map((id) => findObject(doc, id))
    .filter((l): l is NonNullable<typeof l> => !!l);

  function originalsOf(ids: Id[]): Map<Id, SceneObject> {
    const m = new Map<Id, SceneObject>();
    const d = editor.getState().doc;
    for (const id of ids) {
      const loc = findObject(d, id);
      if (loc && !isEffectivelyLocked(loc)) m.set(id, loc.object);
    }
    return m;
  }

  /** Top-level selectable object under the pointer (groups select as a whole). */
  function hitObject(target: EventTarget | null): Id | null {
    let el = target instanceof Element ? target : null;
    let topId: string | null = null;
    while (el && !el.hasAttribute('data-layer-id')) {
      const id = el.getAttribute('data-object-id');
      if (id) topId = id;
      el = el.parentElement;
    }
    if (!el || !topId) return null;
    const loc = findObject(editor.getState().doc, topId);
    if (!loc || isEffectivelyLocked(loc)) return null;
    return topId;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button === 1 || effectiveTool === 'hand') {
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    if (editingText) return;
    const p = toDoc(e.clientX, e.clientY);
    const target = e.target as Element;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);

    if (effectiveTool === 'zoom') {
      const z = editor.getState().zoom;
      const next = e.altKey ? [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) : ZOOM_STEPS.find((s) => s > z + 1e-6);
      if (next) setZoomAt(next, e.clientX, e.clientY);
      return;
    }

    if (effectiveTool === 'select') {
      const handle = target.getAttribute('data-handle');
      if (handle) {
        startHandleGesture(handle as Handle | 'rotate', p);
        return;
      }
      const hit = hitObject(target);
      if (hit) {
        const sel = editor.getState().selection;
        if (e.shiftKey) {
          editor.select(sel.includes(hit) ? sel.filter((s) => s !== hit) : [...sel, hit]);
          return;
        }
        const ids = sel.includes(hit) ? sel : [hit];
        if (!sel.includes(hit)) editor.select(ids);
        editor.beginGesture();
        gesture.current = { kind: 'move', start: p, originals: originalsOf(ids), moved: false };
        return;
      }
      gesture.current = {
        kind: 'marquee',
        start: p,
        current: p,
        additive: e.shiftKey,
        base: e.shiftKey ? editor.getState().selection : [],
      };
      if (!e.shiftKey) editor.select([]);
      return;
    }

    if (SHAPE_TOOLS[effectiveTool]) {
      if (!writableLayer(editor, editor.getState().activeLayerId)) return;
      gesture.current = { kind: 'create', tool: effectiveTool, start: p, current: p, id: null };
      return;
    }

    if (effectiveTool === 'text') {
      // Keep the browser's default mousedown focus change from blurring the new editor.
      e.preventDefault();
      const hit = hitObject(target);
      const loc = hit ? findObject(editor.getState().doc, hit) : null;
      if (loc && loc.object.type === 'text') {
        editor.select([hit!]);
        setEditingText({ id: hit!, isNew: false });
        return;
      }
      const layerId = writableLayer(editor, editor.getState().activeLayerId);
      if (!layerId) return;
      const t = createText('', { x: p.x, y: p.y, width: 10, height: 10, rotation: 0 });
      const size = measureText({ ...t, text: 'M' });
      t.box = { ...t.box, y: p.y - size.height / 2, width: size.width, height: size.height };
      // The new text and its first edit form one undo step (see TextEditor.commit).
      editor.beginGesture();
      editor.preview((d) => addObject(d, layerId, t));
      editor.select([t.id]);
      setEditingText({ id: t.id, isNew: true });
    }
  }

  function startPan(e: React.PointerEvent) {
    const el = scrollRef.current!;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    gesture.current = {
      kind: 'pan',
      startClient: { x: e.clientX, y: e.clientY },
      startScroll: { x: el.scrollLeft, y: el.scrollTop },
    };
    e.preventDefault();
  }

  function startHandleGesture(handle: Handle | 'rotate', p: Point) {
    const ids = editor.getState().selection;
    const originals = originalsOf(ids);
    if (!originals.size) return;
    const objs = [...originals.values()];
    const bounds = unionBounds(objs)!;
    const single = objs.length === 1 && objs[0].type !== 'group' ? objs[0].box : null;
    editor.beginGesture();
    if (handle === 'rotate') {
      const center = single ? boxCenter(single) : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      gesture.current = { kind: 'rotate', center, startAngle: angleTo(center, p), originals };
    } else {
      gesture.current = { kind: 'resize', handle, originals, single, bounds };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = toDoc(e.clientX, e.clientY);
    setCursorPos(p);
    const g = gesture.current;
    if (!g) return;
    switch (g.kind) {
      case 'pan': {
        const el = scrollRef.current!;
        el.scrollLeft = g.startScroll.x - (e.clientX - g.startClient.x);
        el.scrollTop = g.startScroll.y - (e.clientY - g.startClient.y);
        break;
      }
      case 'move': {
        let dx = p.x - g.start.x;
        let dy = p.y - g.start.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (!g.moved && Math.hypot(dx, dy) * zoom < 2) return;
        g.moved = true;
        applyTransformed(g.originals, (o) => transformObject(o, { pivot: { x: 0, y: 0 }, sx: 1, sy: 1, rotation: 0, dx, dy }));
        break;
      }
      case 'resize': {
        const opt = { keepAspect: e.shiftKey, fromCenter: e.altKey };
        if (g.single) {
          const [id, orig] = [...g.originals][0];
          const isText = orig.type === 'text';
          const box = resizeBox(g.single, g.handle, p, { ...opt, keepAspect: opt.keepAspect || isText });
          applyTransformed(new Map([[id, orig]]), (o) => resizeLeaf(o, box));
        } else {
          const t = boundsResize(g.bounds, g.handle, p, opt);
          applyTransformed(g.originals, (o) => transformObject(o, { ...t, rotation: 0, dx: 0, dy: 0 }));
        }
        break;
      }
      case 'rotate': {
        let delta = angleTo(g.center, p) - g.startAngle;
        if (e.shiftKey) delta = snapAngle(delta);
        applyTransformed(g.originals, (o) =>
          transformObject(o, { pivot: g.center, sx: 1, sy: 1, rotation: delta, dx: 0, dy: 0 }),
        );
        break;
      }
      case 'marquee': {
        g.current = p;
        const r = dragRect(g.start, p, false, false);
        setMarquee(r);
        const hits = objectsInRect(editor.getState().doc, r);
        editor.select([...new Set([...g.base, ...hits])]);
        break;
      }
      case 'create': {
        g.current = p;
        updateCreate(g, e.shiftKey, e.altKey);
        break;
      }
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    switch (g.kind) {
      case 'move':
        editor.endGesture('移動');
        break;
      case 'resize':
        editor.endGesture('拡大縮小');
        break;
      case 'rotate':
        editor.endGesture('回転');
        break;
      case 'marquee':
        setMarquee(null);
        break;
      case 'create': {
        if (!g.id) {
          // Click without drag: create a default-sized shape at the point.
          const size = 100;
          const kind = SHAPE_TOOLS[g.tool]!;
          const start = kind === 'line' || kind === 'arrow' ? { x: g.start.x - size / 2, y: g.start.y } : { x: g.start.x - size / 2, y: g.start.y - size / 2 };
          g.start = start;
          g.current = kind === 'line' || kind === 'arrow' ? { x: start.x + size, y: start.y } : { x: start.x + size, y: start.y + size };
          updateCreate(g, false, false);
        }
        editor.endGesture('図形の作成');
        if (g.id) editor.select([g.id]);
        break;
      }
      case 'pan':
        break;
    }
    void e;
  }

  function updateCreate(g: Extract<Gesture, { kind: 'create' }>, shift: boolean, alt: boolean) {
    const kind = SHAPE_TOOLS[g.tool]!;
    let box: Box;
    let geometry = defaultGeometry(kind);
    if (g.tool === 'rounded-rect') geometry = { kind: 'rect', cornerRadius: 12 };
    if (kind === 'line' || kind === 'arrow') {
      const a = g.start;
      const b = shift ? snap45(a, g.current) : g.current;
      const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
      const w = Math.max(1, r.width);
      const h = Math.max(1, r.height);
      box = { x: r.x - (w - r.width) / 2, y: r.y - (h - r.height) / 2, width: w, height: h, rotation: 0 };
      const norm = (p: Point) => ({ x: (p.x - box.x) / w, y: (p.y - box.y) / h });
      geometry = { ...(geometry as { kind: 'line' }), from: norm(a), to: norm(b) } as ShapeGeometry;
    } else {
      const r = dragRect(g.start, g.current, shift, alt);
      box = { ...r, width: Math.max(1, r.width), height: Math.max(1, r.height), rotation: 0 };
    }
    if (!g.id) {
      const layerId = writableLayer(editor, editor.getState().activeLayerId);
      if (!layerId) {
        gesture.current = null;
        return;
      }
      const shape = createShape(geometry, box);
      g.id = shape.id;
      editor.beginGesture();
      editor.preview((d) => addObject(d, layerId, shape));
    } else {
      const id = g.id;
      editor.preview((d) => updateObject(d, id, { box, shape: geometry } as Partial<SceneObject>));
    }
  }

  function applyTransformed(originals: Map<Id, SceneObject>, fn: (o: SceneObject) => SceneObject) {
    editor.preview((d) => {
      for (const [id, orig] of originals) {
        const loc = findObject(d, id);
        if (loc) loc.siblings[loc.index] = fn(orig);
      }
    });
  }

  function onDoubleClick(e: React.MouseEvent) {
    if (effectiveTool !== 'select') return;
    const hit = hitObject(e.target);
    if (!hit) return;
    const loc = findObject(editor.getState().doc, hit);
    if (loc?.object.type === 'text') setEditingText({ id: hit, isNew: false });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) void placeImageFiles(editor, files);
    else if (e.dataTransfer.files.length) editor.notify('error', 'ドロップされたファイルは画像ではありません。');
  }

  const cursor =
    effectiveTool === 'hand'
      ? gesture.current?.kind === 'pan'
        ? 'grabbing'
        : 'grab'
      : effectiveTool === 'zoom'
        ? 'zoom-in'
        : effectiveTool === 'text'
          ? 'text'
          : effectiveTool === 'select'
            ? 'default'
            : 'crosshair';

  const editingObj = editingText ? findObject(doc, editingText.id)?.object : null;

  return (
    <div className="center">
    <div
      className="workspace"
      ref={scrollRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      data-testid="workspace"
    >
      <div
        className="stage"
        ref={stageRef}
        style={{ width: doc.width * zoom + PAD * 2, height: doc.height * zoom + PAD * 2, cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          if (gesture.current && gesture.current.kind !== 'pan' && gesture.current.kind !== 'marquee') editor.cancelGesture();
          gesture.current = null;
          setMarquee(null);
        }}
        onPointerLeave={() => setCursorPos(null)}
        onDoubleClick={onDoubleClick}
      >
        <div
          className={`canvas-frame${doc.background.kind === 'transparent' ? ' checker' : ''}`}
          style={{ left: PAD, top: PAD, width: doc.width * zoom, height: doc.height * zoom }}
          data-testid="canvas"
        >
          <DocumentSvg
            doc={doc}
            width={doc.width * zoom}
            height={doc.height * zoom}
            options={{ imageHref: (o) => imageCache.href(o), hitAreas: true, hiddenId: editingText?.id, idPrefix: 'screen' }}
          />
        </div>
        <svg
          className="overlay"
          style={{ left: PAD, top: PAD }}
          width={doc.width * zoom}
          height={doc.height * zoom}
          viewBox={`0 0 ${doc.width} ${doc.height}`}
          overflow="visible"
        >
          <SelectionOverlay locs={selectedObjects} zoom={zoom} showHandles={tool === 'select' && !editingText} />
          {marquee && (
            <rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.width}
              height={marquee.height}
              className="marquee"
              strokeWidth={1 / zoom}
            />
          )}
        </svg>
        {editingObj && editingObj.type === 'text' && (
          <TextEditor
            key={editingObj.id}
            obj={editingObj}
            zoom={zoom}
            isNew={editingText!.isNew}
            onDone={() => setEditingText(null)}
          />
        )}
      </div>
    </div>
    <StatusBar cursor={cursorPos} />
    </div>
  );
}

function resizeLeaf(o: SceneObject, box: Box): SceneObject {
  if (o.type === 'group') return o;
  if (o.type === 'text') {
    const k = box.height / o.box.height;
    return { ...o, box, fontSize: Math.max(1, o.fontSize * k), letterSpacing: o.letterSpacing * k };
  }
  return { ...o, box };
}

function objectsInRect(doc: SparcaDocument, r: Rect): Id[] {
  const out: Id[] = [];
  for (const layer of doc.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const o of layer.children) {
      if (!o.visible || o.locked) continue;
      const b = objectBounds(o);
      if (b && rectsIntersect(r, b) && r.width > 0 && r.height > 0) out.push(o.id);
    }
  }
  return out;
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function SelectionOverlay({
  locs,
  zoom,
  showHandles,
}: {
  locs: NonNullable<ReturnType<typeof findObject>>[];
  zoom: number;
  showHandles: boolean;
}) {
  if (!locs.length) return null;
  const k = 1 / zoom;
  const hs = 8 * k;
  const outlines = locs.flatMap((l) => leafOutlines(l.object));
  const editable = locs.filter((l) => !isEffectivelyLocked(l));
  let frame: Box | null = null;
  if (editable.length === 1 && editable[0].object.type !== 'group') frame = editable[0].object.box;
  else if (editable.length) {
    const b = unionBounds(editable.map((l) => l.object));
    if (b) frame = { ...b, rotation: 0 };
  }
  return (
    <g className="selection">
      {outlines.map((pts, i) => (
        <polygon key={i} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} className="sel-outline" strokeWidth={k} />
      ))}
      {frame && showHandles && (
        <>
          <polygon
            points={boxCorners(frame).map((p) => `${p.x},${p.y}`).join(' ')}
            className="sel-frame"
            strokeWidth={k}
          />
          <RotateHandle frame={frame} k={k} />
          {HANDLES.map((h) => {
            const p = handlePoint(frame!, h);
            return (
              <rect
                key={h}
                data-handle={h}
                className="handle"
                x={p.x - hs / 2}
                y={p.y - hs / 2}
                width={hs}
                height={hs}
                strokeWidth={k}
                style={{ cursor: handleCursor(h, frame!.rotation) }}
                transform={frame!.rotation ? `rotate(${frame!.rotation} ${p.x} ${p.y})` : undefined}
              />
            );
          })}
        </>
      )}
    </g>
  );
}

function RotateHandle({ frame, k }: { frame: Box; k: number }) {
  const top = handlePoint(frame, 'n');
  const c = boxCenter(frame);
  const len = Math.hypot(top.x - c.x, top.y - c.y) || 1;
  const off = 24 * k;
  const p = { x: top.x + ((top.x - c.x) / len) * off, y: top.y + ((top.y - c.y) / len) * off };
  return (
    <>
      <line x1={top.x} y1={top.y} x2={p.x} y2={p.y} className="sel-frame" strokeWidth={k} />
      <circle data-handle="rotate" cx={p.x} cy={p.y} r={5 * k} className="handle rotate" strokeWidth={k} />
    </>
  );
}

function leafOutlines(o: SceneObject): Point[][] {
  if (o.type === 'group') return o.children.flatMap(leafOutlines);
  return [boxCorners(o.box)];
}

const CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
function handleCursor(h: Handle, rotation: number): string {
  const f = handleFraction(h);
  const angle = (Math.atan2(f.y - 0.5, f.x - 0.5) * 180) / Math.PI + rotation;
  const idx = Math.round((((angle + 90) % 180) + 180) % 180 / 45) % 4;
  return CURSORS[idx];
}

function TextEditor({ obj, zoom, isNew, onDone }: { obj: TextObject; zoom: number; isNew: boolean; onDone: () => void }) {
  const [value, setValue] = useState(obj.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const f = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(f);
  }, []);
  const size = measureText({ ...obj, text: value || 'M' });

  function commit() {
    if (done.current) return;
    done.current = true;
    const id = obj.id;
    if (!value.trim()) {
      if (isNew) editor.cancelGesture();
      else editor.edit('テキストの削除', (d) => removeObjects(d, [id]));
    } else {
      const m = measureText({ ...obj, text: value });
      if (value !== obj.text) {
        editor.edit('テキストの編集', (d) =>
          updateObject(d, id, { text: value, box: { ...obj.box, width: m.width, height: m.height } } as Partial<SceneObject>),
        );
      }
      if (isNew) editor.endGesture('テキストの追加');
    }
    onDone();
  }

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          commit();
        }
      }}
      style={{
        left: PAD + obj.box.x * zoom,
        top: PAD + obj.box.y * zoom,
        width: (Math.max(size.width, obj.box.width) + obj.fontSize) * zoom,
        height: size.height * zoom,
        fontFamily: obj.fontFamily,
        fontSize: obj.fontSize * zoom,
        fontWeight: obj.bold ? 'bold' : 'normal',
        fontStyle: obj.italic ? 'italic' : 'normal',
        letterSpacing: obj.letterSpacing * zoom,
        lineHeight: obj.lineHeight,
        color: obj.color,
        textAlign: obj.align,
        transform: obj.box.rotation ? `rotate(${obj.box.rotation}deg)` : undefined,
        transformOrigin: `${(obj.box.width * zoom) / 2}px ${(obj.box.height * zoom) / 2}px`,
      }}
    />
  );
}

function StatusBar({ cursor }: { cursor: Point | null }) {
  const doc = useEditor((s) => s.doc);
  const zoom = useEditor((s) => s.zoom);
  return (
    <div className="statusbar">
      <span>
        キャンバス {doc.width} × {doc.height} px
      </span>
      <span>{Math.round(zoom * 100)}%</span>
      <span>{cursor ? `X ${Math.round(cursor.x)}  Y ${Math.round(cursor.y)}` : ''}</span>
    </div>
  );
}
