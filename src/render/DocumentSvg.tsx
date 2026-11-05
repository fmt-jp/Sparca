// Document → SVG. The same component renders the on-screen canvas and the export image,
// so what you see is what gets exported (docs/design.md §3).
import type { ReactElement } from 'react';
import type {
  Box,
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
import { maskContentTransform } from '../model/mask';
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
  /**
   * The object whose mask layer is being edited (screen only): its mask content can be picked
   * on the canvas; with view 'mask' the mask itself is shown in gray instead of the object.
   */
  maskEdit?: { id: string; view: 'result' | 'mask' } | null;
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
  if (opts.maskEdit?.id === o.id && o.mask && o.visible) return renderMaskEdit(o, opts, prefix, canvas);
  return renderPlain(o, opts, prefix, canvas);
}

/**
 * Small picture of an object's mask (for the layers panel): its background and content in
 * gray, over the area of the object.
 */
export function MaskPreview({ o, size = 22 }: { o: SceneObject; size?: number }): ReactElement | null {
  const mask = o.mask;
  const b = mask ? objectBounds(o) : null;
  if (!mask || !b) return null;
  const opts: RenderOptions = { imageHref: () => undefined, idPrefix: `thumb-${o.id}` };
  const content = mask.children.map((c) => renderObject(c, opts, `thumb-${o.id}`, { width: b.width, height: b.height }));
  const placed = o.type !== 'group' && mask.frame ? <g transform={leafTransform(o.box) + ' ' + maskContentTransform(mask.frame, o.box)}>{content}</g> : content;
  const fid = `thumb-${o.id}-gray`;
  const w = size * Math.min(2, Math.max(0.5, b.width / (b.height || 1)));
  return (
    <svg width={w} height={size} viewBox={`${b.x} ${b.y} ${b.width} ${b.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <filter id={fid} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={GRAY} />
        </filter>
      </defs>
      <rect x={b.x} y={b.y} width={b.width} height={b.height} fill={mask.background === 'white' ? '#ffffff' : '#000000'} />
      <g filter={`url(#${fid})`}>{placed}</g>
    </svg>
  );
}

/** Options for drawing mask content: no hit areas, nothing hidden, and ids of its own. */
function contentOpts(opts: RenderOptions): RenderOptions {
  return { ...opts, hitAreas: false, hiddenId: null, maskEdit: null };
}

/** Gray by luminance, the way a luminance mask reads the colors. */
const GRAY = '0.2125 0.7154 0.0721 0 0  0.2125 0.7154 0.0721 0 0  0.2125 0.7154 0.0721 0 0  0 0 0 1 0';

/**
 * The object whose mask layer is being edited: as it looks (view 'result') with its mask
 * content laid over it invisibly so it can be picked, or (view 'mask') the mask itself in gray.
 */
function renderMaskEdit(o: SceneObject, opts: RenderOptions, prefix: string, canvas: { width: number; height: number }): ReactElement {
  const mask = o.mask!;
  const content = mask.children.map((c) => renderObject(c, { ...opts, maskEdit: null }, `${prefix}-e`, canvas));
  const mapped = o.type !== 'group' && mask.frame ? <g transform={leafTransform(o.box) + ' ' + maskContentTransform(mask.frame, o.box)}>{content}</g> : content;
  if (opts.maskEdit?.view === 'mask') {
    const fid = `${prefix}-maskview-${o.id}`;
    const cid = `${fid}-clip`;
    const region = maskRegion(o);
    const bg = mask.background === 'white' ? '#ffffff' : '#000000';
    // Shown only where the mask applies (its content may reach further).
    const clipRect = region && <rect x={region.x} y={region.y} width={region.width} height={region.height} transform={o.type === 'group' ? undefined : leafTransform(o.box)} />;
    return (
      <g key={o.id} data-mask-of={o.id}>
        <defs>
          <filter id={fid} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={GRAY} />
          </filter>
          <clipPath id={cid} clipPathUnits="userSpaceOnUse">
            {clipRect}
          </clipPath>
        </defs>
        <g filter={`url(#${fid})`} clipPath={region ? `url(#${cid})` : undefined}>
          {region && (o.type === 'group' ? (
            <rect x={region.x} y={region.y} width={region.width} height={region.height} fill={bg} pointerEvents="none" />
          ) : (
            <rect transform={leafTransform(o.box)} x={region.x} y={region.y} width={region.width} height={region.height} fill={bg} pointerEvents="none" />
          ))}
          {mapped}
        </g>
      </g>
    );
  }
  return (
    <g key={o.id}>
      {renderPlain(o, opts, prefix, canvas)}
      <g data-mask-of={o.id} opacity={0}>
        {mapped}
      </g>
    </g>
  );
}

function leafTransform(b: Box): string {
  return `translate(${b.x} ${b.y})` + (b.rotation ? ` rotate(${b.rotation} ${b.width / 2} ${b.height / 2})` : '');
}

/**
 * Where an object's mask applies: for a leaf, its box widened by what shows past it (in its
 * own frame); for a group, the area its children show in (document coordinates).
 */
function maskRegion(o: SceneObject): Rect | null {
  if (o.type === 'group') return groupReach(o.children);
  const m = leafReach(o) + 1;
  return { x: -m, y: -m, width: o.box.width + 2 * m, height: o.box.height + 2 * m };
}

function renderPlain(o: SceneObject, opts: RenderOptions, prefix: string, canvas: { width: number; height: number }): ReactElement | null {
  if (!o.visible || o.id === opts.hiddenId) return null;
  if (o.type === 'group') {
    const children = o.children.map((c) => renderObject(c, opts, prefix, canvas));
    const mask = groupMask(o, `${prefix}-mask-${o.id}`, opts, prefix, canvas);
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
  // The mask layer fades the object together with its effects (decided with the user).
  if (o.mask?.enabled && content) {
    const m = strokeWidth + reach + effectsMargin(o.effects) + 1;
    const mid = `${prefix}-mask-${o.id}`;
    const inner = o.mask.children.map((c) => renderObject(c, contentOpts(opts), `${prefix}-m`, canvas));
    const placed = o.mask.frame ? <g transform={maskContentTransform(o.mask.frame, o.box)}>{inner}</g> : inner;
    defs.push(<defs key={mid}>{maskDef(o.mask.background, mid, { x: -m, y: -m, width: w + 2 * m, height: h + 2 * m }, placed)}</defs>);
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

/** A luminance <mask> over `region` (user space of the masked element): the background, then the content. */
function maskDef(background: 'white' | 'black', id: string, region: Rect, content: ReactElement | (ReactElement | null)[]): ReactElement {
  return (
    <mask id={id} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x={region.x} y={region.y} width={region.width} height={region.height}>
      <rect x={region.x} y={region.y} width={region.width} height={region.height} fill={background === 'white' ? '#ffffff' : '#000000'} />
      {content}
    </mask>
  );
}

/** How far an object shows past its box (its children's, for a group), whole px. */
export function reachOf(o: SceneObject): number {
  if (o.type !== 'group') return Math.ceil(leafReach(o));
  return o.children.reduce((m, c) => Math.max(m, reachOf(c)), 0);
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
function groupMask(
  o: GroupObject,
  id: string,
  opts: RenderOptions,
  prefix: string,
  canvas: { width: number; height: number },
): { def: ReactElement; ref: string } | null {
  if (!o.mask?.enabled) return null;
  const region = groupReach(o.children);
  if (!region) return null;
  const inner = o.mask.children.map((c) => renderObject(c, contentOpts(opts), `${prefix}-m`, canvas));
  return { def: maskDef(o.mask.background, id, region, inner), ref: `url(#${id})` };
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
