// Document → SVG. The same component renders the on-screen canvas and the export image,
// so what you see is what gets exported (docs/design.md §3).
import type { ReactElement } from 'react';
import type {
  Effects,
  ImageObject,
  PathObject,
  SceneObject,
  ShapeObject,
  SparcaDocument,
  TextObject,
} from '../model/types';
import { pathNodesD, shapePaths } from './shapes';
import { textLines, textBaselineOffset } from './text';

export interface RenderOptions {
  /** URL of the processed raster for an image object (blob: on screen, data: for export). */
  imageHref: (o: ImageObject) => string | undefined;
  /** Hide this object (e.g. while editing text in place). */
  hiddenId?: string | null;
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
          <g key={layer.id} data-layer-id={layer.id}>
            {layer.children.map((o) => renderObject(o, options, prefix))}
          </g>
        ) : null,
      )}
    </svg>
  );
}

function renderObject(o: SceneObject, opts: RenderOptions, prefix: string): ReactElement | null {
  if (!o.visible || o.id === opts.hiddenId) return null;
  if (o.type === 'group') {
    return (
      <g key={o.id} data-object-id={o.id} opacity={o.opacity}>
        {o.children.map((c) => renderObject(c, opts, prefix))}
      </g>
    );
  }
  const { x, y, width: w, height: h, rotation } = o.box;
  const transform =
    `translate(${x} ${y})` + (rotation ? ` rotate(${rotation} ${w / 2} ${h / 2})` : '');
  const filterId = hasEffects(o.effects) ? `${prefix}-fx-${o.id}` : null;
  let body: ReactElement | null;
  let strokeWidth = 0;
  switch (o.type) {
    case 'shape':
      body = renderShape(o);
      strokeWidth = o.stroke ? o.strokeWidth : 0;
      break;
    case 'path':
      body = renderPath(o);
      strokeWidth = o.stroke ? o.strokeWidth : 0;
      break;
    case 'text':
      body = renderText(o);
      break;
    case 'image':
      body = renderImage(o, opts);
      break;
  }
  return (
    <g key={o.id} data-object-id={o.id} transform={transform} opacity={o.opacity}>
      {filterId && effectsFilter(filterId, o.effects, w, h, rotation, strokeWidth)}
      <g filter={filterId ? `url(#${filterId})` : undefined}>{body}</g>
    </g>
  );
}

function renderShape(o: ShapeObject): ReactElement {
  const { width: w, height: h } = o.box;
  const p = shapePaths(o.shape, w, h, o.strokeWidth);
  const stroke = o.stroke && o.strokeWidth > 0 ? o.stroke : 'none';
  return (
    <>
      <path
        d={p.d}
        fill={p.open ? 'none' : (o.fill ?? 'none')}
        stroke={stroke}
        strokeWidth={o.strokeWidth}
        strokeLinejoin="round"
        strokeLinecap={p.open ? 'round' : 'butt'}
      />
      {p.headD && <path d={p.headD} fill={o.stroke ?? '#000'} stroke="none" />}
    </>
  );
}

function renderPath(o: PathObject): ReactElement {
  const { width: w, height: h } = o.box;
  return (
    <path
      d={pathNodesD(o.nodes, o.closed, w, h)}
      fill={o.closed ? (o.fill ?? 'none') : 'none'}
      stroke={o.stroke && o.strokeWidth > 0 ? o.stroke : 'none'}
      strokeWidth={o.strokeWidth}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}

function renderText(o: TextObject): ReactElement {
  const lines = textLines(o.text);
  const lh = o.fontSize * o.lineHeight;
  const anchor = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start';
  const ax = o.align === 'center' ? o.box.width / 2 : o.align === 'right' ? o.box.width : 0;
  const base = textBaselineOffset(o.fontSize, o.lineHeight);
  return (
    <text
      fontFamily={o.fontFamily}
      fontSize={o.fontSize}
      fontWeight={o.bold ? 'bold' : 'normal'}
      fontStyle={o.italic ? 'italic' : 'normal'}
      fill={o.color}
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

export function hasEffects(e: Effects): boolean {
  return e.glow.enabled || e.dropShadow.enabled;
}

function effectsFilter(
  id: string,
  e: Effects,
  w: number,
  h: number,
  rotation: number,
  strokeWidth: number,
): ReactElement {
  const ds = e.dropShadow;
  const gl = e.glow;
  // The filter works in the rotated local frame; counter-rotate the shadow
  // direction so the shadow falls the same way regardless of object rotation.
  const a = ((ds.angle - rotation) * Math.PI) / 180;
  const dx = Math.cos(a) * ds.distance;
  const dy = Math.sin(a) * ds.distance;
  const margin =
    strokeWidth +
    Math.max(
      ds.enabled ? ds.distance + ds.blur * 3 : 0,
      gl.enabled ? gl.spread + gl.blur * 3 : 0,
    ) +
    8;
  return (
    <defs>
      <filter
        id={id}
        filterUnits="userSpaceOnUse"
        x={-margin}
        y={-margin}
        width={w + margin * 2}
        height={h + margin * 2}
        colorInterpolationFilters="sRGB"
      >
        {ds.enabled && (
          <>
            <feGaussianBlur in="SourceAlpha" stdDeviation={ds.blur / 2} result="dsBlur" />
            <feOffset in="dsBlur" dx={dx} dy={dy} result="dsOff" />
            <feFlood floodColor={ds.color} floodOpacity={ds.opacity} result="dsColor" />
            <feComposite in="dsColor" in2="dsOff" operator="in" result="shadow" />
          </>
        )}
        {gl.enabled && (
          <>
            <feMorphology in="SourceAlpha" operator="dilate" radius={gl.spread} result="glSpread" />
            <feGaussianBlur in="glSpread" stdDeviation={gl.blur / 2} result="glBlur" />
            <feFlood floodColor={gl.color} floodOpacity={gl.opacity} result="glColor" />
            <feComposite in="glColor" in2="glBlur" operator="in" result="glow" />
          </>
        )}
        <feMerge>
          {ds.enabled && <feMergeNode in="shadow" />}
          {gl.enabled && <feMergeNode in="glow" />}
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}
