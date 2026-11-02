// Document → SVG. The same component renders the on-screen canvas and the export image,
// so what you see is what gets exported (docs/design.md §3).
import type { ReactElement } from 'react';
import type {
  Box,
  Gradient,
  GroupObject,
  ImageObject,
  PathObject,
  SceneObject,
  ShapeObject,
  SparcaDocument,
  StrokeCap,
  StrokeStyle,
  TextObject,
} from '../model/types';
import { objectBounds, type Rect } from '../model/geometry';
import { maskFrame } from '../model/mask';
import { effectsFilter, effectsMargin, splitAtZoomBlur, zoomBlurLayers, zoomBlurReach } from './effects';
import { cssFontFamily } from './fonts';
import { fillPaint } from './gradient';
import { pathNodesD, shapePaths } from './shapes';
import { textLines, textBaselineOffset } from './text';
import { layoutTextOnPath } from './textOnPath';

export interface RenderOptions {
  /** URL of the processed raster for an image object (blob: on screen, data: for export). */
  imageHref: (o: ImageObject) => string | undefined;
  /** Hide this object (e.g. while editing text in place). */
  hiddenId?: string | null;
  /** Add invisible hit areas (text boxes, thin lines) for on-screen pointer interaction. */
  hitAreas?: boolean;
  /** Prefix for filter ids, so several SVGs on one page do not collide. */
  idPrefix?: string;
}

export function DocumentSvg({
  doc,
  options,
  width,
  height,
  forExport = false,
}: {
  doc: SparcaDocument;
  options: RenderOptions;
  width?: number;
  height?: number;
  forExport?: boolean;
}): ReactElement {
  const prefix = options.idPrefix ?? 'sp';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      width={width ?? doc.width}
      height={height ?? doc.height}
      viewBox={`0 0 ${doc.width} ${doc.height}`}
      overflow={forExport ? 'hidden' : 'visible'}
      style={forExport ? undefined : { overflow: 'visible', display: 'block' }}
    >
      {doc.background.kind === 'color' && (
        <rect x={0} y={0} width={doc.width} height={doc.height} fill={doc.background.color} />
      )}
      {doc.layers.map((layer) =>
        layer.visible ? (
          <g key={layer.id} data-layer-id={layer.id} data-name={forExport ? layer.name : undefined}>
            {layer.children.map((o) => renderObject(o, options, prefix, doc))}
          </g>
        ) : null,
      )}
    </svg>
  );
}

function renderObject(o: SceneObject, opts: RenderOptions, prefix: string, canvas: { width: number; height: number }): ReactElement | null {
  if (!o.visible || o.id === opts.hiddenId) return null;
  if (o.type === 'group') {
    const children = o.children.map((c) => renderObject(c, opts, prefix, canvas));
    const mask = groupMask(o, `${prefix}-mask-${o.id}`);
    return (
      <g key={o.id} data-object-id={o.id} opacity={o.opacity}>
        {mask ? (
          <>
            <defs>{mask.def}</defs>
            <g mask={mask.ref}>{children}</g>
          </>
        ) : (
          children
        )}
      </g>
    );
  }
  const { x, y, width: w, height: h, rotation } = o.box;
  const transform =
    `translate(${x} ${y})` + (rotation ? ` rotate(${rotation} ${w / 2} ${h / 2})` : '');
  const filterId = `${prefix}-fx-${o.id}`;
  let body: ReactElement | null;
  let strokeWidth = 0;
  const fillId = `${prefix}-fill-${o.id}`;
  switch (o.type) {
    case 'shape':
      body = renderShape(o, fillId);
      strokeWidth = o.stroke ? strokeReach(o) : 0;
      break;
    case 'path':
      body = renderPath(o, fillId);
      strokeWidth = o.stroke ? strokeReach(o) : 0;
      break;
    case 'text':
      body = renderText(o, fillId);
      // Letters on a path reach past the box (it is the path's box); widen the effect region.
      if (o.path) strokeWidth = o.fontSize * 1.5 + Math.abs(o.path.shift);
      break;
    case 'image':
      body = renderImage(o, opts);
      break;
  }
  // Effects run in order; each zoom blur splits them into filters around its copies.
  const defs: ReactElement[] = [];
  let content: ReactElement | null = body;
  let reach = 0;
  splitAtZoomBlur(o.effects).forEach((seg, i) => {
    const id = i === 0 ? filterId : `${filterId}-${i}`;
    const filter = effectsFilter(id, seg.effects, w, h, rotation, strokeWidth + reach);
    if (filter) {
      defs.push(<g key={id}>{filter}</g>);
      content = <g filter={`url(#${id})`}>{content}</g>;
    }
    if (seg.zoom && content) {
      const zid = `${filterId}-z${i}`;
      const z = zoomBlurLayers(content, seg.zoom, w, h, zid);
      if (z.def) defs.push(<defs key={zid}>{z.def}</defs>);
      // The streaks stay inside the canvas (also on screen, where the workspace around
      // the canvas is otherwise visible). The clip is the canvas rectangle expressed in
      // the object's own (translated, rotated) coordinates.
      const cid = `${zid}-clip`;
      defs.push(
        <defs key={cid}>
          <clipPath id={cid} clipPathUnits="userSpaceOnUse">
            <rect
              x={0}
              y={0}
              width={canvas.width}
              height={canvas.height}
              transform={(rotation ? `rotate(${-rotation} ${w / 2} ${h / 2}) ` : '') + `translate(${-x} ${-y})`}
            />
          </clipPath>
        </defs>,
      );
      content = <g clipPath={`url(#${cid})`}>{z.layers}</g>;
      reach += zoomBlurReach(seg.zoom, w, h);
    }
  });
  // The gradient mask fades the object together with its effects (decided with the user).
  if (o.mask?.enabled && content) {
    const m = strokeWidth + reach + effectsMargin(o.effects) + 1;
    const mid = `${prefix}-mask-${o.id}`;
    defs.push(<defs key={mid}>{maskDef(o.mask.gradient, mid, { x: -m, y: -m, width: w + 2 * m, height: h + 2 * m }, w, h, m)}</defs>);
    content = <g mask={`url(#${mid})`}>{content}</g>;
  }
  return (
    <g key={o.id} data-object-id={o.id} transform={transform} opacity={o.opacity}>
      {defs}
      {content}
      {opts.hitAreas && hitArea(o)}
    </g>
  );
}

/**
 * A luminance <mask> painted with `gradient` over `region` (user space of the masked element).
 * The gradient is normalized to a w×h frame at the origin, or to `frame` (document space, for
 * groups); `margin` is how far the region reaches past the frame (for conic images).
 */
function maskDef(gradient: Gradient, id: string, region: Rect, w: number, h: number, margin: number, frame?: Box): ReactElement {
  const paint = fillPaint(gradient, `${id}-g`, w, h, margin);
  const local = frame ? toFrame(frame, region) : region;
  const rect = <rect x={local.x} y={local.y} width={local.width} height={local.height} fill={paint.paint} />;
  return (
    <mask id={id} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x={region.x} y={region.y} width={region.width} height={region.height}>
      {paint.def}
      {frame ? <g transform={`translate(${frame.x} ${frame.y})` + (frame.rotation ? ` rotate(${frame.rotation} ${frame.width / 2} ${frame.height / 2})` : '')}>{rect}</g> : rect}
    </mask>
  );
}

/** Bounds of a document-space rectangle in a frame's own (unrotated, origin at its corner) coordinates. */
function toFrame(frame: Box, r: Rect): Rect {
  const c = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  const pts = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x, y: r.y + r.height },
    { x: r.x + r.width, y: r.y + r.height },
  ].map((p) => {
    const a = (-frame.rotation * Math.PI) / 180;
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: c.x + dx * Math.cos(a) - dy * Math.sin(a) - frame.x, y: c.y + dx * Math.sin(a) + dy * Math.cos(a) - frame.y };
  });
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** How far a leaf object shows past its box (stroke, letters on a path, effects). */
function leafReach(o: Exclude<SceneObject, GroupObject>): number {
  let m = effectsMargin(o.effects);
  if ((o.type === 'shape' || o.type === 'path') && o.stroke) m += strokeReach(o);
  if (o.type === 'text' && o.path) m += o.fontSize * 1.5 + Math.abs(o.path.shift);
  for (const seg of splitAtZoomBlur(o.effects)) if (seg.zoom) m += zoomBlurReach(seg.zoom, o.box.width, o.box.height);
  return m;
}

/** Document-space area a group's children can show in (boxes widened by what shows past them). */
function groupReach(children: SceneObject[]): Rect | null {
  const pts: { x: number; y: number }[] = [];
  const visit = (list: SceneObject[]) => {
    for (const c of list) {
      if (c.type === 'group') {
        visit(c.children);
        continue;
      }
      const b = objectBounds(c);
      if (!b) continue;
      const m = leafReach(c) + 1;
      pts.push({ x: b.x - m, y: b.y - m }, { x: b.x + b.width + m, y: b.y + b.height + m });
    }
  };
  visit(children);
  if (!pts.length) return null;
  const x = Math.min(...pts.map((p) => p.x));
  const y = Math.min(...pts.map((p) => p.y));
  return { x, y, width: Math.max(...pts.map((p) => p.x)) - x, height: Math.max(...pts.map((p) => p.y)) - y };
}

/** The mask of a group (document space), if it has one switched on. */
function groupMask(o: GroupObject, id: string): { def: ReactElement; ref: string } | null {
  if (!o.mask?.enabled) return null;
  const frame = maskFrame(o);
  const region = groupReach(o.children);
  if (!frame || !region) return null;
  const local = toFrame(frame, region);
  const margin = Math.max(0, -local.x, -local.y, local.x + local.width - frame.width, local.y + local.height - frame.height);
  return { def: maskDef(o.mask.gradient, id, region, frame.width, frame.height, margin, frame), ref: `url(#${id})` };
}

/**
 * Dash pattern for a line style, proportional to the stroke width: dashes 4× the width
 * with 2× gaps (flat ends unless an end style was chosen); dots are zero-length dashes with
 * round caps, 2× the width apart. `cap` is the chosen end style, or the default when unset.
 */
export function strokeDash(
  style: StrokeStyle | undefined,
  width: number,
  cap: StrokeCap,
  chosen = false,
): { strokeDasharray?: string; strokeLinecap: StrokeCap } {
  const w = Math.max(width, 0.5);
  if (style === 'dashed') return { strokeDasharray: `${w * 4} ${w * 2}`, strokeLinecap: chosen ? cap : 'butt' };
  if (style === 'dotted') return { strokeDasharray: `0 ${w * 2}`, strokeLinecap: 'round' };
  return { strokeLinecap: cap };
}

/** Miter joins are cut off past this many half widths (as in Illustrator). */
export const MITER_LIMIT = 10;

/** End, corner and dash attributes of an object's stroke. */
function strokeShape(o: Pick<ShapeObject, 'strokeStyle' | 'strokeWidth' | 'strokeCap' | 'strokeJoin'>, open: boolean) {
  return {
    strokeLinejoin: o.strokeJoin ?? 'round',
    strokeMiterlimit: o.strokeJoin === 'miter' ? MITER_LIMIT : undefined,
    ...strokeDash(o.strokeStyle, o.strokeWidth, o.strokeCap ?? (open ? 'round' : 'butt'), o.strokeCap !== undefined),
  };
}

/** How far a stroke can reach past the outline (miter corners reach further than the width). */
export function strokeReach(o: Pick<ShapeObject, 'strokeWidth' | 'strokeJoin'>): number {
  return o.strokeJoin === 'miter' ? (o.strokeWidth * MITER_LIMIT) / 2 : o.strokeWidth;
}

function renderShape(o: ShapeObject, fillId: string): ReactElement {
  const { width: w, height: h } = o.box;
  const p = shapePaths(o.shape, w, h, o.strokeWidth);
  const stroke = fillPaint(o.stroke && o.strokeWidth > 0 ? o.stroke : null, `${fillId}-stroke`, w, h, o.strokeWidth / 2);
  const fill = fillPaint(p.open ? null : o.fill, fillId, w, h);
  return (
    <>
      {(fill.def || stroke.def) && (
        <defs>
          {fill.def}
          {stroke.def}
        </defs>
      )}
      <path
        d={p.d}
        fill={fill.paint}
        stroke={stroke.paint}
        strokeWidth={o.strokeWidth}
        {...strokeShape(o, p.open)}
      />
      {p.headD && <path d={p.headD} fill={o.stroke ? stroke.paint : '#000'} stroke="none" />}
    </>
  );
}

/** Path data of all outlines of a (compound) path. */
export function pathContoursD(o: Pick<PathObject, 'nodes' | 'closed' | 'subpaths'>, w: number, h: number): string {
  return [pathNodesD(o.nodes, o.closed, w, h), ...(o.subpaths ?? []).map((c) => pathNodesD(c.nodes, c.closed, w, h))].join(' ');
}

function renderPath(o: PathObject, fillId: string): ReactElement {
  const { width: w, height: h } = o.box;
  const fill = fillPaint(o.closed ? o.fill : null, fillId, w, h);
  const stroke = fillPaint(o.stroke && o.strokeWidth > 0 ? o.stroke : null, `${fillId}-stroke`, w, h, o.strokeWidth / 2);
  return (
    <>
      {(fill.def || stroke.def) && (
        <defs>
          {fill.def}
          {stroke.def}
        </defs>
      )}
      <path
        d={pathContoursD(o, w, h)}
        fillRule={o.subpaths?.length ? 'evenodd' : undefined}
        fill={fill.paint}
        stroke={stroke.paint}
        strokeWidth={o.strokeWidth}
        {...strokeShape(o, !o.closed)}
      />
    </>
  );
}

/** Text on a path: one positioned <text> per character (see render/textOnPath). */
function renderTextOnPath(o: TextObject, fillId: string): ReactElement {
  const fill = fillPaint(o.color, fillId, o.box.width, o.box.height);
  return (
    <>
      {fill.def && <defs>{fill.def}</defs>}
      <g
        data-text-on-path=""
        fontFamily={cssFontFamily(o.fontFamily)}
        fontSize={o.fontSize}
        fontWeight={o.bold ? 'bold' : 'normal'}
        fontStyle={o.italic ? 'italic' : 'normal'}
        fill={fill.paint}
        textAnchor="middle"
      >
        {layoutTextOnPath(o).map((g, i) => (
          <text key={i} transform={g.transform}>
            {g.char}
          </text>
        ))}
      </g>
    </>
  );
}

function renderText(o: TextObject, fillId: string): ReactElement {
  if (o.path) return renderTextOnPath(o, fillId);
  const lines = textLines(o.text);
  const lh = o.fontSize * o.lineHeight;
  const anchor = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start';
  const ax = o.align === 'center' ? o.box.width / 2 : o.align === 'right' ? o.box.width : 0;
  const base = textBaselineOffset(o.fontSize, o.lineHeight);
  const fill = fillPaint(o.color, fillId, o.box.width, o.box.height);
  return (
    <>
    {fill.def && <defs>{fill.def}</defs>}
    <text
      fontFamily={cssFontFamily(o.fontFamily)}
      fontSize={o.fontSize}
      fontWeight={o.bold ? 'bold' : 'normal'}
      fontStyle={o.italic ? 'italic' : 'normal'}
      fill={fill.paint}
      letterSpacing={o.letterSpacing || undefined}
      textAnchor={anchor}
      style={{ whiteSpace: 'pre' }}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={ax} y={base + i * lh}>
          {line || ' '}
        </tspan>
      ))}
    </text>
    </>
  );
}

function renderImage(o: ImageObject, opts: RenderOptions): ReactElement | null {
  const href = opts.imageHref(o);
  const { width: w, height: h } = o.box;
  if (!href) {
    // Not yet decoded/processed: draw a neutral placeholder so layout is stable.
    return <rect width={w} height={h} fill="#cccccc" opacity={0.5} />;
  }
  return <image href={href} width={w} height={h} preserveAspectRatio="none" />;
}

function hitArea(o: SceneObject): ReactElement | null {
  if (o.type === 'text') return <rect width={o.box.width} height={o.box.height} fill="transparent" />;
  if (o.type === 'shape' && (o.shape.kind === 'line' || o.shape.kind === 'arrow')) {
    const p = shapePaths(o.shape, o.box.width, o.box.height, o.strokeWidth);
    return <path d={p.d} fill="none" stroke="transparent" strokeWidth={Math.max(10, o.strokeWidth)} />;
  }
  if (o.type === 'path' && !o.closed) {
    return (
      <path
        d={pathNodesD(o.nodes, false, o.box.width, o.box.height)}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(10, o.strokeWidth)}
      />
    );
  }
  return null;
}
