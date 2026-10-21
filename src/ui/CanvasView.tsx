import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addObject, removeObjects, updateObject } from '../model/commands';
import { createPath, createShape, createText, defaultGeometry } from '../model/factory';
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
import type { Box, Id, PathNode, Point, SceneObject, ShapeGeometry, SparcaDocument, TextObject } from '../model/types';
import { DocumentSvg } from '../render/DocumentSvg';
import { imageCache } from '../render/imageCache';
import { fitTextBox, measureText } from '../render/text';
import { docToNormalized, normalizedToDoc, objectGradient, representativeColor } from '../model/gradient';
import { placeImageFiles, writableLayer } from '../store/actions';
import type { PixelSelection, ToolId } from '../store/editor';
import { pickColorAt } from '../store/colorActions';
import { docToPath, isSmooth, moveAnchors, moveHandle, nearestOnPath, pathToDoc, type DocNode } from '../model/pathEdit';
import { deleteSelectedNodes, editablePath, insertNode, nudgeNodes, selectedNodes, toggleNodeType } from '../store/pathActions';
import { cancelCrop, commitCrop, startCrop } from '../store/imageActions';
import { hasImageExtension } from '../io/imageFormats';
import { anchorMenu, canvasMenu, objectMenu, segmentNextTo } from './canvasMenu';
import { ContextMenu } from './ContextMenu';
import { isTextEntry } from './keyboard';
import type { MenuItem } from './MenuBar';
import { TabBar } from './TabBar';
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
  arrow: 'block-arrow',
};

/** Default head width of a new block arrow relative to its length. */
const BLOCK_ARROW_ASPECT = 0.55;

type Gesture =
  | { kind: 'move'; start: Point; originals: Map<Id, SceneObject>; moved: boolean }
  | { kind: 'gradient'; id: Id; which: 'start' | 'end' }
  | { kind: 'resize'; handle: Handle; originals: Map<Id, SceneObject>; single: Box | null; bounds: Rect }
  | { kind: 'rotate'; center: Point; startAngle: number; originals: Map<Id, SceneObject> }
  | { kind: 'marquee'; start: Point; current: Point; additive: boolean; base: Id[] }
  | { kind: 'create'; tool: ToolId; start: Point; current: Point; id: Id | null }
  | { kind: 'pan'; startClient: Point; startScroll: Point }
  | { kind: 'crop-new'; start: Point }
  | { kind: 'crop-move'; start: Point; orig: Rect }
  | { kind: 'crop-resize'; handle: Handle; orig: Rect }
  | { kind: 'select-area'; shape: 'rect' | 'ellipse'; start: Point }
  | { kind: 'lasso'; points: Point[] }
  | { kind: 'pen-handle'; index: number }
  | { kind: 'node-move'; pathId: Id; start: Point; orig: DocNode[]; indices: number[]; moved: boolean }
  | { kind: 'handle-move'; pathId: Id; orig: DocNode[]; index: number; which: 'in' | 'out' }
  | { kind: 'node-marquee'; start: Point; base: number[] };

export function CanvasView() {
  const doc = useEditor((s) => s.doc);
  const zoom = useEditor((s) => s.zoom);
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const crop = useEditor((s) => s.crop);
  const pixelSelection = useEditor((s) => s.pixelSelection);
  const compareImageId = useEditor((s) => s.compareImageId);
  const [polyPoints, setPolyPoints] = useState<Point[] | null>(null);
  /** Pen tool path under construction, in document coordinates. */
  const [penNodes, setPenNodes] = useState<PathNode[] | null>(null);
  const penRef = useRef<PathNode[] | null>(null);
  penRef.current = penNodes;
  const [, forceRender] = useState(0);
  useEffect(() => imageCache.subscribe(() => forceRender((n) => n + 1)), []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [editingText, setEditingText] = useState<{ id: Id; isNew: boolean } | null>(null);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; label: string } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

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
  // Switching tabs restores that tab's last scroll position.
  const activeTabId = useEditor((s) => s.activeTabId);
  const tabScroll = useRef(new Map<string, Point>());
  const shownTab = useRef(activeTabId);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = shownTab.current !== activeTabId ? tabScroll.current.get(activeTabId) : undefined;
    shownTab.current = activeTabId;
    if (saved) {
      el.scrollLeft = saved.x;
      el.scrollTop = saved.y;
      return;
    }
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.width, doc.height, activeTabId]);

  // Zooming at the pointer (zoom tool, Ctrl+wheel) keeps the point under the cursor fixed.
  // Other zooming (buttons, menu, shortcuts) keeps the view centered: the whole canvas is
  // centered when it fits, otherwise the document point at the middle of the view stays there.
  const zoomAnchor = useRef<{ doc: Point; client: Point } | null>(null);
  const prevZoom = useRef(zoom);
  const zoomTab = useRef(activeTabId);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const before = prevZoom.current;
    prevZoom.current = zoom;
    // A different tab brings its own zoom; its scroll position is restored above.
    if (zoomTab.current !== activeTabId) {
      zoomTab.current = activeTabId;
      return;
    }
    if (!el || !stageRef.current) return;
    const a = zoomAnchor.current;
    if (a) {
      zoomAnchor.current = null;
      const r = stageRef.current.getBoundingClientRect();
      el.scrollLeft += r.left + PAD + a.doc.x * zoom - a.client.x;
      el.scrollTop += r.top + PAD + a.doc.y * zoom - a.client.y;
      return;
    }
    if (before === zoom) return;
    const { width: dw, height: dh } = editor.getState().doc;
    const center = (scroll: number, view: number, size: number) =>
      size * zoom <= view ? size / 2 : Math.min(size, Math.max(0, (scroll + view / 2 - PAD) / before));
    const cx = center(el.scrollLeft, el.clientWidth, dw);
    const cy = center(el.scrollTop, el.clientHeight, dh);
    el.scrollLeft = PAD + cx * zoom - el.clientWidth / 2;
    el.scrollTop = PAD + cy * zoom - el.clientHeight / 2;
  }, [zoom, activeTabId]);

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
      const onControl = e.target instanceof HTMLElement && /^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if (e.code === 'Space' && !onControl && !isTyping(e) && !e.repeat) {
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

  // In-progress drawing belongs to the document it started in.
  useEffect(() => {
    setPolyPoints(null);
    setPenNodes(null);
    setEditingText(null);
    setMarquee(null);
    gesture.current = null;
  }, [activeTabId]);

  // Entering the crop tool picks the target (selected image or the document).
  useEffect(() => {
    if (tool === 'crop' && !editor.getState().crop) startCrop(editor);
    if (tool !== 'polygon-lasso') setPolyPoints(null);
    if (tool !== 'pen' && penRef.current) finishPen(penRef.current, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // Enter / Escape for the crop tool and the polygon lasso.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (editor.getState().tool === 'subselect' && editor.getState().nodeSelection.length && !e.ctrlKey && !e.metaKey) {
        const step = e.shiftKey ? 10 : 1;
        const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        let handled = false;
        if (e.key === 'Delete' || e.key === 'Backspace') handled = deleteSelectedNodes(editor);
        else if (arrows[e.key]) handled = nudgeNodes(editor, ...arrows[e.key]);
        else if (e.key === 'Escape') {
          editor.set({ nodeSelection: [] });
          handled = true;
        }
        if (handled) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
      }
      if (penNodes && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finishPen(penNodes, false);
        return;
      }
      if (polyPoints) {
        // The last point follows the pointer; it is not a placed vertex.
        if (e.key === 'Enter') finishPolygon(polyPoints.slice(0, -1));
        if (e.key === 'Escape') setPolyPoints(null);
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }
      const c = editor.getState().crop;
      if (editor.getState().tool === 'crop' && c?.rect) {
        if (e.key === 'Enter') commitCrop(editor);
        if (e.key === 'Escape') cancelCrop(editor);
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }
    };
    // Capture phase so these keys don't also reach the global shortcuts.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  /** Turn the pen nodes into a path object (box-normalized nodes). */
  function finishPen(nodes: PathNode[], closed: boolean) {
    setPenNodes(null);
    // A double-click places the same anchor twice; drop consecutive duplicates.
    const clean = nodes.filter((n, i) => i === 0 || Math.hypot(n.anchor.x - nodes[i - 1].anchor.x, n.anchor.y - nodes[i - 1].anchor.y) > 0.5);
    if (clean.length < 2) return;
    const pts = clean.flatMap((n) => [n.anchor, ...(n.in ? [n.in] : []), ...(n.out ? [n.out] : [])]);
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const w = Math.max(1, Math.max(...xs) - x0);
    const h = Math.max(1, Math.max(...ys) - y0);
    const norm = (q: Point | null) => (q ? { x: (q.x - x0) / w, y: (q.y - y0) / h } : null);
    const path = createPath(
      clean.map((n) => ({ anchor: norm(n.anchor)!, in: norm(n.in), out: norm(n.out) })),
      closed,
      { x: x0, y: y0, width: w, height: h, rotation: 0 },
    );
    const layerId = writableLayer(editor, editor.getState().activeLayerId);
    if (!layerId) return;
    editor.edit('パスの作成', (d) => addObject(d, layerId, path));
    editor.select([path.id]);
    editor.setTool('select');
  }

  function setCrop(rect: Rect | null) {
    const c = editor.getState().crop;
    if (c) editor.set({ crop: { ...c, rect } });
  }

  function finishPolygon(points: Point[]) {
    setPolyPoints(null);
    if (points.length >= 3) editor.set({ pixelSelection: { kind: 'polygon', points } });
  }

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

    if (effectiveTool === 'eyedropper') {
      void pickColorAt(editor, p.x, p.y);
      return;
    }

    if (effectiveTool === 'pen') {
      if (!penNodes) {
        if (!writableLayer(editor, editor.getState().activeLayerId)) return;
        setPenNodes([{ anchor: editor.snap(p), in: null, out: null }]);
        gesture.current = { kind: 'pen-handle', index: 0 };
        return;
      }
      const first = penNodes[0].anchor;
      if (penNodes.length >= 2 && Math.hypot(first.x - p.x, first.y - p.y) * zoom < 8) {
        finishPen(penNodes, true);
        return;
      }
      if (e.detail >= 2) {
        finishPen(penNodes, false);
        return;
      }
      setPenNodes([...penNodes, { anchor: editor.snap(p), in: null, out: null }]);
      gesture.current = { kind: 'pen-handle', index: penNodes.length };
      return;
    }

    if (effectiveTool === 'crop') {
      const c = editor.getState().crop;
      const ch = target.getAttribute('data-crop-handle');
      if (c?.rect && ch) {
        gesture.current = { kind: 'crop-resize', handle: ch as Handle, orig: c.rect };
      } else if (c?.rect && pointInRect(p, c.rect)) {
        gesture.current = { kind: 'crop-move', start: p, orig: c.rect };
      } else {
        gesture.current = { kind: 'crop-new', start: editor.snap(p) };
        setCrop({ x: p.x, y: p.y, width: 0, height: 0 });
      }
      return;
    }

    if (effectiveTool === 'marquee-rect' || effectiveTool === 'marquee-ellipse') {
      editor.set({ pixelSelection: null });
      gesture.current = { kind: 'select-area', shape: effectiveTool === 'marquee-rect' ? 'rect' : 'ellipse', start: p };
      return;
    }
    if (effectiveTool === 'lasso') {
      editor.set({ pixelSelection: null });
      gesture.current = { kind: 'lasso', points: [p] };
      return;
    }
    if (effectiveTool === 'polygon-lasso') {
      if (!polyPoints) {
        setPolyPoints([p, p]);
        return;
      }
      const first = polyPoints[0];
      const closeEnough = Math.hypot(first.x - p.x, first.y - p.y) * zoom < 8;
      // Closing click on the start point, or the second click of a double-click
      // (whose first click already placed this vertex).
      if (closeEnough || e.detail >= 2) finishPolygon(polyPoints.slice(0, -1));
      else setPolyPoints([...polyPoints.slice(0, -1), p, p]);
      return;
    }

    if (effectiveTool === 'subselect') {
      const path = editablePath(editor);
      const nodeAttr = target.getAttribute('data-node');
      const handleAttr = target.getAttribute('data-node-handle');
      if (path && handleAttr) {
        const [i, which] = handleAttr.split(':');
        editor.beginGesture();
        gesture.current = { kind: 'handle-move', pathId: path.id, orig: pathToDoc(path), index: Number(i), which: which as 'in' | 'out' };
        return;
      }
      if (path && nodeAttr) {
        const i = Number(nodeAttr);
        const sel = selectedNodes(editor, path);
        let next = sel;
        if (e.shiftKey) next = sel.includes(i) ? sel.filter((k) => k !== i) : [...sel, i];
        else if (!sel.includes(i)) next = [i];
        editor.set({ nodeSelection: next });
        if (!next.includes(i)) return;
        editor.beginGesture();
        gesture.current = { kind: 'node-move', pathId: path.id, start: p, orig: pathToDoc(path), indices: next, moved: false };
        return;
      }
      const hit = hitObject(target);
      if (hit) {
        // Selecting another object; paths show their anchors for editing.
        if (editor.getState().selection[0] !== hit || editor.getState().selection.length !== 1) editor.select([hit]);
        return;
      }
      if (path) {
        gesture.current = { kind: 'node-marquee', start: p, base: e.shiftKey ? selectedNodes(editor, path) : [] };
        if (!e.shiftKey) editor.set({ nodeSelection: [] });
      } else editor.select([]);
      return;
    }

    if (effectiveTool === 'select') {
      const gh = target.getAttribute('data-gradient-handle');
      if (gh && selection.length === 1) {
        editor.beginGesture();
        gesture.current = { kind: 'gradient', id: selection[0], which: gh as 'start' | 'end' };
        return;
      }
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
      const sp = editor.snap(p);
      gesture.current = { kind: 'create', tool: effectiveTool, start: sp, current: sp, id: null };
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
      const tp = editor.snap(p);
      const t = createText('', { x: tp.x, y: tp.y, width: 10, height: 10, rotation: 0 });
      const size = measureText({ ...t, text: 'M' });
      // Text is centered vertically on the click; with snapping its top-left sits on the grid.
      const top = editor.getState().grid.snap ? tp.y : p.y - size.height / 2;
      t.box = { ...t.box, y: top, width: size.width, height: size.height };
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
    if (polyPoints) setPolyPoints([...polyPoints.slice(0, -1), p]);
    const g = gesture.current;
    if (!g) return;
    switch (g.kind) {
      case 'node-move': {
        let dx = p.x - g.start.x;
        let dy = p.y - g.start.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (!g.moved && Math.hypot(dx, dy) * zoom < 2) break;
        g.moved = true;
        // With grid snapping, the first selected anchor lands on the grid.
        const lead = g.orig[g.indices[0]].anchor;
        const snapped = editor.snap({ x: lead.x + dx, y: lead.y + dy });
        previewPath(g.pathId, moveAnchors(g.orig, g.indices, snapped.x - lead.x, snapped.y - lead.y));
        break;
      }
      case 'handle-move': {
        const anchor = g.orig[g.index].anchor;
        const q = e.shiftKey ? snap45(anchor, p) : p;
        previewPath(g.pathId, moveHandle(g.orig, g.index, g.which, q, e.altKey));
        break;
      }
      case 'node-marquee': {
        const r = dragRect(g.start, p, false, false);
        setMarquee(r);
        const path = editablePath(editor);
        if (!path) break;
        const inside = pathToDoc(path)
          .map((n, i) => (pointInRect(n.anchor, r) ? i : -1))
          .filter((i) => i >= 0);
        editor.set({ nodeSelection: [...new Set([...g.base, ...inside])] });
        break;
      }
      case 'pen-handle': {
        const nodes = penRef.current;
        if (!nodes) break;
        const n = nodes[g.index];
        if (Math.hypot(p.x - n.anchor.x, p.y - n.anchor.y) * zoom < 3) break;
        // Dragging pulls out symmetric handles: a smooth bezier anchor.
        const out = e.shiftKey ? snap45(n.anchor, p) : p;
        const updated = { ...n, out, in: { x: 2 * n.anchor.x - out.x, y: 2 * n.anchor.y - out.y } };
        setPenNodes(nodes.map((m, i) => (i === g.index ? updated : m)));
        break;
      }
      case 'crop-new':
        setCrop(dragRect(g.start, editor.snap(p), e.shiftKey, e.altKey));
        break;
      case 'crop-move':
        setCrop({ ...g.orig, x: g.orig.x + p.x - g.start.x, y: g.orig.y + p.y - g.start.y });
        break;
      case 'crop-resize': {
        const b = resizeBox({ ...g.orig, rotation: 0 }, g.handle, editor.snap(p), { keepAspect: e.shiftKey, fromCenter: e.altKey });
        setCrop({ x: b.x, y: b.y, width: b.width, height: b.height });
        break;
      }
      case 'select-area': {
        const r = dragRect(g.start, p, e.shiftKey, e.altKey);
        editor.set({ pixelSelection: r.width > 0 && r.height > 0 ? { kind: g.shape, ...r } : null });
        break;
      }
      case 'lasso': {
        const last = g.points[g.points.length - 1];
        if (Math.hypot(last.x - p.x, last.y - p.y) * zoom >= 2) g.points.push(p);
        editor.set({ pixelSelection: g.points.length >= 3 ? { kind: 'polygon', points: [...g.points] } : null });
        break;
      }
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
        // With grid snapping, the top-left of the moved objects lands on the grid.
        const b = unionBounds([...g.originals.values()]);
        if (b) {
          const snapped = editor.snap({ x: b.x + dx, y: b.y + dy });
          dx = snapped.x - b.x;
          dy = snapped.y - b.y;
        }
        applyTransformed(g.originals, (o) => transformObject(o, { pivot: { x: 0, y: 0 }, sx: 1, sy: 1, rotation: 0, dx, dy }));
        break;
      }
      case 'gradient': {
        const loc = findObject(editor.getState().doc, g.id);
        const cur = loc && objectGradient(loc.object);
        if (!loc || !cur) return;
        const box = cur.box;
        let q = p;
        if (e.shiftKey) {
          // Shift: keep the direction from the other handle at 45° steps.
          const other = normalizedToDoc(box, g.which === 'start' ? cur.gradient.end : cur.gradient.start);
          const a = (snapAngle(angleTo(other, p)) * Math.PI) / 180;
          const len = Math.hypot(p.x - other.x, p.y - other.y);
          q = { x: other.x + Math.cos(a) * len, y: other.y + Math.sin(a) * len };
        }
        const n = docToNormalized(box, q);
        const next = { ...cur.gradient, [g.which]: n };
        editor.preview((d) => updateObject(d, g.id, { [cur.key]: next } as Partial<SceneObject>));
        break;
      }
      case 'resize': {
        const opt = { keepAspect: e.shiftKey, fromCenter: e.altKey };
        const p = editor.snap(toDoc(e.clientX, e.clientY));
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
        g.current = editor.snap(p);
        updateCreate(g, e.shiftKey, e.altKey);
        break;
      }
    }
  }

  function onPointerUp() {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    switch (g.kind) {
      case 'move':
        editor.endGesture('移動');
        break;
      case 'gradient':
        editor.endGesture('グラデーションの調整');
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
          const kind = SHAPE_TOOLS[g.tool]!;
          const directional = kind === 'line' || kind === 'arrow' || kind === 'block-arrow';
          const size = kind === 'block-arrow' ? 160 : 100;
          const start = directional ? { x: g.start.x - size / 2, y: g.start.y } : { x: g.start.x - size / 2, y: g.start.y - size / 2 };
          g.start = start;
          g.current = directional ? { x: start.x + size, y: start.y } : { x: start.x + size, y: start.y + size };
          updateCreate(g, false, false);
        }
        editor.endGesture('図形の作成');
        if (g.id) {
          editor.select([g.id]);
          // Back to the select tool, so the next click edits instead of drawing another shape.
          editor.setTool('select');
        }
        break;
      }
      case 'pan':
        break;
      case 'crop-new': {
        const r = editor.getState().crop?.rect;
        if (r && (r.width * zoom < 3 || r.height * zoom < 3)) setCrop(null);
        break;
      }
      case 'select-area': {
        // A click without a real drag leaves no selection.
        const sel = editor.getState().pixelSelection;
        if (sel && sel.kind !== 'polygon' && (sel.width * zoom < 2 || sel.height * zoom < 2)) editor.set({ pixelSelection: null });
        break;
      }
      case 'lasso':
        if (g.points.length < 3) editor.set({ pixelSelection: null });
        break;
      case 'node-move':
        editor.endGesture('アンカーの移動');
        break;
      case 'handle-move':
        editor.endGesture('ハンドルの移動');
        break;
      case 'node-marquee':
        setMarquee(null);
        break;
    }
  }

  /** Preview edited document-space nodes on a path during a drag. */
  function previewPath(id: Id, nodes: DocNode[]) {
    editor.preview((d) => {
      const loc = findObject(d, id);
      if (!loc || loc.object.type !== 'path') return;
      const fit = docToPath(loc.object.box, nodes);
      updateObject(d, id, { box: fit.box, nodes: fit.nodes } as Partial<SceneObject>);
    });
  }

  function updateCreate(g: Extract<Gesture, { kind: 'create' }>, shift: boolean, alt: boolean) {
    const kind = SHAPE_TOOLS[g.tool]!;
    let box: Box;
    let geometry = defaultGeometry(kind);
    if (g.tool === 'rounded-rect') geometry = { kind: 'rect', cornerRadius: 12 };
    if (kind === 'block-arrow') {
      // Drag from tail to tip: length and direction from the drag, head width from the length.
      const a = g.start;
      const b = shift ? snap45(a, g.current) : g.current;
      const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const h = Math.max(1, len * BLOCK_ARROW_ASPECT);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const rotation = Math.hypot(b.x - a.x, b.y - a.y) < 1e-6 ? 0 : angleTo(a, b);
      box = { x: cx - len / 2, y: cy - h / 2, width: len, height: h, rotation: Math.round(rotation * 100) / 100 };
    } else if (kind === 'line' || kind === 'arrow') {
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
    // Pointer capture (set on pointerdown) retargets click events to the stage,
    // so look up what is actually under the pointer.
    const under = document.elementFromPoint(e.clientX, e.clientY) ?? e.target;
    if (effectiveTool === 'subselect') {
      const path = editablePath(editor);
      if (!path) return;
      const nodeAttr = (under as Element).getAttribute('data-node');
      if (nodeAttr) {
        toggleNodeType(editor, Number(nodeAttr));
        return;
      }
      // Double-click on the path's outline adds an anchor there.
      const hitPos = nearestOnPath(pathToDoc(path), path.closed, toDoc(e.clientX, e.clientY));
      if (hitPos && hitPos.dist * zoom <= 8) insertNode(editor, hitPos.segment, hitPos.t);
      return;
    }
    if (effectiveTool !== 'select') return;
    // On thin paths the outline lies under the selection handles; treat those as the path.
    const sel = editor.getState().selection;
    const onHandle = (under as Element).hasAttribute?.('data-handle') && sel.length === 1;
    const hit = onHandle ? sel[0] : hitObject(under);
    if (!hit) return;
    const loc = findObject(editor.getState().doc, hit);
    if (loc?.object.type === 'text') setEditingText({ id: hit, isNew: false });
    // Double-clicking a path switches to anchor editing.
    if (loc?.object.type === 'path' && !isEffectivelyLocked(loc)) {
      editor.select([hit]);
      editor.setTool('subselect');
    }
  }

  function onContextMenu(e: React.MouseEvent) {
    // Text being edited keeps the browser's menu (paste, spell check).
    if (isTextEntry(e.target)) return;
    e.preventDefault();
    if (editingText || penNodes || polyPoints || gesture.current) return;
    const under = document.elementFromPoint(e.clientX, e.clientY) ?? e.target;
    const p = toDoc(e.clientX, e.clientY);
    if (tool === 'subselect') {
      const path = editablePath(editor);
      const nodeAttr = (under as Element).getAttribute?.('data-node');
      if (path && nodeAttr) {
        const i = Number(nodeAttr);
        if (!selectedNodes(editor, path).includes(i)) editor.set({ nodeSelection: [i] });
        setMenu({ x: e.clientX, y: e.clientY, items: anchorMenu(segmentNextTo(i)), label: 'パスの点のメニュー' });
        return;
      }
      if (path) {
        const near = nearestOnPath(pathToDoc(path), path.closed, p);
        if (near && near.dist * zoom <= 8) {
          setMenu({ x: e.clientX, y: e.clientY, items: anchorMenu(near), label: 'パスの点のメニュー' });
          return;
        }
      }
    }
    const sel = editor.getState().selection;
    const onHandle = (under as Element).hasAttribute?.('data-handle') && sel.length > 0;
    const hit = onHandle ? sel[0] : hitObject(under);
    if (hit) {
      // Like other editors: right-clicking outside the selection selects that object first.
      if (!sel.includes(hit)) editor.select([hit]);
      setMenu({ x: e.clientX, y: e.clientY, items: objectMenu(), label: 'オブジェクトのメニュー' });
      return;
    }
    setMenu({ x: e.clientX, y: e.clientY, items: canvasMenu(), label: 'キャンバスのメニュー' });
  }

  // Keyboard: the Menu key or Shift+F10 opens the menu for the selection (or the canvas).
  const keyMenuAt = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
      if (isTextEntry(e.target) || (e.target as Element | null)?.closest?.('[role="dialog"], [role="menu"]')) return;
      e.preventDefault();
      keyMenuAt.current = Date.now();
      const { selection: sel, doc: d, zoom: z } = editor.getState();
      const stage = stageRef.current;
      const ws = scrollRef.current;
      if (!stage || !ws) return;
      const sr = stage.getBoundingClientRect();
      const wr = ws.getBoundingClientRect();
      const locs = sel.map((id) => findObject(d, id)).filter((l) => !!l);
      let x = wr.left + wr.width / 2;
      let y = wr.top + wr.height / 2;
      const b = unionBounds(locs.map((l) => l.object));
      if (b) {
        x = Math.min(wr.right - 8, Math.max(wr.left + 8, sr.left + PAD + (b.x + b.width / 2) * z));
        y = Math.min(wr.bottom - 8, Math.max(wr.top + 8, sr.top + PAD + (b.y + b.height / 2) * z));
      }
      setMenu(
        locs.length
          ? { x, y, items: objectMenu(), label: 'オブジェクトのメニュー' }
          : { x, y, items: canvasMenu(), label: 'キャンバスのメニュー' },
      );
    };
    // The key also fires a native contextmenu event right after; swallow that one.
    const onNative = (e: MouseEvent) => {
      if (Date.now() - keyMenuAt.current < 1000) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('contextmenu', onNative);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('contextmenu', onNative);
    };
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/') || hasImageExtension(f.name));
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
          : effectiveTool === 'select' || effectiveTool === 'subselect'
            ? 'default'
            : 'crosshair';

  const editingObj = editingText ? findObject(doc, editingText.id)?.object : null;

  return (
    <div className="center">
    <TabBar />
    <div
      className="workspace"
      ref={scrollRef}
      onScroll={(e) => tabScroll.current.set(activeTabId, { x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop })}
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
        onContextMenu={onContextMenu}
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
            options={{ imageHref: (o) => imageCache.href(o, o.id === compareImageId), hitAreas: true, hiddenId: editingText?.id, idPrefix: 'screen' }}
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
          <GridOverlay width={doc.width} height={doc.height} zoom={zoom} />
          <SelectionOverlay locs={selectedObjects} zoom={zoom} showHandles={tool === 'select' && !editingText} />
          {tool === 'select' && !editingText && selectedObjects.length === 1 && !isEffectivelyLocked(selectedObjects[0]) && (
            <GradientHandles o={selectedObjects[0].object} zoom={zoom} />
          )}
          {pixelSelection && <PixelSelectionOutline sel={pixelSelection} zoom={zoom} />}
          {polyPoints && (
            <polyline points={polyPoints.map((q) => `${q.x},${q.y}`).join(' ')} className="ants-a" strokeWidth={1 / zoom} />
          )}
          {tool === 'crop' && crop && <CropOverlay crop={crop} doc={doc} zoom={zoom} />}
          {penNodes && <PenPreview nodes={penNodes} cursor={cursorPos} zoom={zoom} />}
          {tool === 'subselect' && <PathNodeOverlay zoom={zoom} />}
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
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} label={menu.label} onClose={closeMenu} />}
    </div>
  );
}

/** Anchors and handles of the selected path for the subselect tool. */
function PathNodeOverlay({ zoom }: { zoom: number }) {
  useEditor((s) => s.doc);
  useEditor((s) => s.selection);
  const nodeSel = useEditor((s) => s.nodeSelection);
  const path = editablePath(editor);
  if (!path) return null;
  const k = 1 / zoom;
  const nodes = pathToDoc(path);
  const sel = new Set(nodeSel.filter((i) => i < nodes.length));
  // Handles are shown for selected anchors and for the neighbors' handles facing them.
  const showHandle = (i: number, which: 'in' | 'out') => {
    if (sel.has(i)) return true;
    const n = nodes.length;
    const neighbor = which === 'out' ? (i + 1) % n : (i - 1 + n) % n;
    const wraps = which === 'out' ? i === n - 1 : i === 0;
    return sel.has(neighbor) && (!wraps || path.closed);
  };
  return (
    <g data-testid="path-nodes">
      {nodes.map((n, i) =>
        (['in', 'out'] as const).map((which) => {
          const h = n[which];
          if (!h || !showHandle(i, which)) return null;
          return (
            <g key={`${i}-${which}`}>
              <line x1={n.anchor.x} y1={n.anchor.y} x2={h.x} y2={h.y} className="pen-handle-line" strokeWidth={k} />
              <circle data-node-handle={`${i}:${which}`} cx={h.x} cy={h.y} r={4 * k} className="handle node-handle" strokeWidth={k} />
            </g>
          );
        }),
      )}
      {nodes.map((n, i) => {
        const smooth = isSmooth(n);
        const s = 8 * k;
        const cls = `handle node-anchor${sel.has(i) ? ' selected' : ''}`;
        return smooth ? (
          <circle key={i} data-node={i} cx={n.anchor.x} cy={n.anchor.y} r={s / 2} className={cls} strokeWidth={k} />
        ) : (
          <rect key={i} data-node={i} x={n.anchor.x - s / 2} y={n.anchor.y - s / 2} width={s} height={s} className={cls} strokeWidth={k} />
        );
      })}
    </g>
  );
}

/** Grid lines over the canvas area (screen only, never exported). */
function GridOverlay({ width, height, zoom }: { width: number; height: number; zoom: number }) {
  const grid = useEditor((s) => s.grid);
  // Too dense to be useful (and expensive) when lines would be closer than 4 screen px.
  if (!grid.visible || grid.size * zoom < 4) return null;
  return (
    <g data-testid="grid" pointerEvents="none">
      <defs>
        <pattern id="sparca-grid" width={grid.size} height={grid.size} patternUnits="userSpaceOnUse">
          <path d={`M ${grid.size} 0 L 0 0 0 ${grid.size}`} fill="none" stroke={grid.color} strokeWidth={1 / zoom} opacity={0.6} />
        </pattern>
      </defs>
      <rect x={0} y={0} width={width} height={height} fill="url(#sparca-grid)" />
    </g>
  );
}

function PenPreview({ nodes, cursor, zoom }: { nodes: PathNode[]; cursor: Point | null; zoom: number }) {
  const k = 1 / zoom;
  const P = (q: Point) => `${q.x} ${q.y}`;
  let d = `M${P(nodes[0].anchor)}`;
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    d += a.out || b.in ? ` C${P(a.out ?? a.anchor)} ${P(b.in ?? b.anchor)} ${P(b.anchor)}` : ` L${P(b.anchor)}`;
  }
  const last = nodes[nodes.length - 1];
  return (
    <g data-testid="pen-preview">
      <path d={d} className="pen-path" strokeWidth={k} />
      {cursor && <line x1={last.anchor.x} y1={last.anchor.y} x2={cursor.x} y2={cursor.y} className="pen-rubber" strokeWidth={k} />}
      {nodes.map((n, i) => (
        <g key={i}>
          {n.in && <line x1={n.anchor.x} y1={n.anchor.y} x2={n.in.x} y2={n.in.y} className="pen-handle-line" strokeWidth={k} />}
          {n.out && <line x1={n.anchor.x} y1={n.anchor.y} x2={n.out.x} y2={n.out.y} className="pen-handle-line" strokeWidth={k} />}
          {n.in && <circle cx={n.in.x} cy={n.in.y} r={3 * k} className="pen-handle" strokeWidth={k} />}
          {n.out && <circle cx={n.out.x} cy={n.out.y} r={3 * k} className="pen-handle" strokeWidth={k} />}
          <rect x={n.anchor.x - 3.5 * k} y={n.anchor.y - 3.5 * k} width={7 * k} height={7 * k} className={i === 0 ? 'pen-anchor first' : 'pen-anchor'} strokeWidth={k} />
        </g>
      ))}
    </g>
  );
}

function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height;
}

function PixelSelectionOutline({ sel, zoom }: { sel: PixelSelection; zoom: number }) {
  const k = 1 / zoom;
  const shape = (cls: string) =>
    sel.kind === 'rect' ? (
      <rect className={cls} x={sel.x} y={sel.y} width={sel.width} height={sel.height} strokeWidth={k} />
    ) : sel.kind === 'ellipse' ? (
      <ellipse className={cls} cx={sel.x + sel.width / 2} cy={sel.y + sel.height / 2} rx={sel.width / 2} ry={sel.height / 2} strokeWidth={k} />
    ) : (
      <polygon className={cls} points={sel.points.map((q) => `${q.x},${q.y}`).join(' ')} strokeWidth={k} />
    );
  // Two dashed strokes offset against each other = "marching ants" visible on any background.
  return (
    <g data-testid="pixel-selection">
      {shape('ants-a')}
      {shape('ants-b')}
    </g>
  );
}

function CropOverlay({ crop, doc, zoom }: { crop: NonNullable<ReturnType<typeof editor.getState>['crop']>; doc: SparcaDocument; zoom: number }) {
  const k = 1 / zoom;
  const target = crop.target === 'image' && crop.imageId ? findObject(doc, crop.imageId)?.object : null;
  const r = crop.rect;
  const hs = 8 * k;
  // Outer area to dim: canvas (document crop) or the image bounds (image crop).
  const outer = target && target.type !== 'group' ? objectBounds(target)! : { x: 0, y: 0, width: doc.width, height: doc.height };
  return (
    <g data-testid="crop-overlay">
      {target && target.type !== 'group' && (
        <polygon points={boxCorners(target.box).map((q) => `${q.x},${q.y}`).join(' ')} className="crop-target" strokeWidth={k} />
      )}
      {r && (
        <>
          <path
            className="crop-shade"
            fillRule="evenodd"
            d={`M${outer.x} ${outer.y} h${outer.width} v${outer.height} h${-outer.width} Z M${r.x} ${r.y} v${r.height} h${r.width} v${-r.height} Z`}
          />
          <rect className="crop-rect" x={r.x} y={r.y} width={r.width} height={r.height} strokeWidth={k} />
          {HANDLES.map((h) => {
            const q = handlePoint({ ...r, rotation: 0 }, h);
            return (
              <rect
                key={h}
                data-crop-handle={h}
                className="handle"
                x={q.x - hs / 2}
                y={q.y - hs / 2}
                width={hs}
                height={hs}
                strokeWidth={k}
                style={{ cursor: handleCursor(h, 0) }}
              />
            );
          })}
        </>
      )}
    </g>
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
  return isTextEntry(e.target);
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

/** Start (circle) and end (square) of the selected object's gradient, joined by a line. */
function GradientHandles({ o, zoom }: { o: SceneObject; zoom: number }) {
  const cur = objectGradient(o);
  if (!cur) return null;
  const k = 1 / zoom;
  const a = normalizedToDoc(cur.box, cur.gradient.start);
  const b = normalizedToDoc(cur.box, cur.gradient.end);
  const s = 9 * k;
  const label = { linear: ['始点', '終点'], radial: ['中心', '半径'], conic: ['中心', '開始方向'] }[cur.gradient.kind];
  return (
    <g className="gradient-handles" data-testid="gradient-handles">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="gradient-line" strokeWidth={1.5 * k} />
      <circle data-gradient-handle="start" cx={a.x} cy={a.y} r={s / 2} className="gradient-handle" strokeWidth={1.5 * k}>
        <title>グラデーションの{label[0]}（ドラッグで移動）</title>
      </circle>
      <rect data-gradient-handle="end" x={b.x - s / 2} y={b.y - s / 2} width={s} height={s} className="gradient-handle" strokeWidth={1.5 * k}>
        <title>グラデーションの{label[1]}（ドラッグで移動、Shift で 45° 刻み）</title>
      </rect>
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
  // The editor follows the box the text will get, so centered / right-aligned text
  // grows around its alignment point while typing.
  const live = fitTextBox({ ...obj, text: value || 'M' });
  // Extra room for the caret, split according to the alignment.
  const pad = obj.fontSize;
  const padLeft = obj.align === 'center' ? pad / 2 : obj.align === 'right' ? pad : 0;

  function commit() {
    if (done.current) return;
    done.current = true;
    const id = obj.id;
    if (!value.trim()) {
      if (isNew) editor.cancelGesture();
      else editor.edit('テキストの削除', (d) => removeObjects(d, [id]));
    } else {
      if (value !== obj.text) {
        editor.edit('テキストの編集', (d) =>
          updateObject(d, id, { text: value, box: fitTextBox({ ...obj, text: value }) } as Partial<SceneObject>),
        );
      }
      if (isNew) editor.endGesture('テキストの追加');
    }
    onDone();
    if (editor.getState().tool === 'text') editor.setTool('select');
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
        left: PAD + (live.x - padLeft) * zoom,
        top: PAD + live.y * zoom,
        width: (live.width + pad) * zoom,
        height: live.height * zoom,
        fontFamily: obj.fontFamily,
        fontSize: obj.fontSize * zoom,
        fontWeight: obj.bold ? 'bold' : 'normal',
        fontStyle: obj.italic ? 'italic' : 'normal',
        letterSpacing: obj.letterSpacing * zoom,
        lineHeight: obj.lineHeight,
        color: representativeColor(obj.color) ?? undefined,
        textAlign: obj.align,
        transform: obj.box.rotation ? `rotate(${obj.box.rotation}deg)` : undefined,
        // Rotate about the box center, as the rendered text does.
        transformOrigin: `${(padLeft + live.width / 2) * zoom}px ${(live.height / 2) * zoom}px`,
      }}
    />
  );
}

function StatusBar({ cursor }: { cursor: Point | null }) {
  const doc = useEditor((s) => s.doc);
  const zoom = useEditor((s) => s.zoom);
  const sel = useEditor((s) => s.pixelSelection);
  const grid = useEditor((s) => s.grid);
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => imageCache.subscribe(() => setProgress(imageCache.progress)), []);
  return (
    <div className="statusbar">
      {progress !== null && (
        <span className="progress" data-testid="processing">
          画像処理中 {Math.round(progress * 100)}%
        </span>
      )}
      {sel && <span>範囲選択あり（Esc で解除）</span>}
      <span className="status-toggles">
        <label>
          <input type="checkbox" checked={grid.visible} onChange={(e) => editor.setGrid({ visible: e.target.checked })} /> グリッド
        </label>
        <label>
          <input type="checkbox" checked={grid.snap} onChange={(e) => editor.setGrid({ snap: e.target.checked })} /> スナップ
        </label>
      </span>
      <span>
        キャンバス {doc.width} × {doc.height} px
      </span>
      <span>{Math.round(zoom * 100)}%</span>
      <span>{cursor ? `X ${Math.round(cursor.x)}  Y ${Math.round(cursor.y)}` : ''}</span>
    </div>
  );
}
