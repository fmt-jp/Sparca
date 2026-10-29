// HANABI document data model. See docs/design.md §2.

export type Id = string;
export type AssetId = string;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise, around the box center. */
  rotation: number;
}

export interface Point {
  x: number;
  y: number;
}

interface EffectCommon {
  id: string;
  enabled: boolean;
  /** How much of the effect is applied: 0 = off, 1 = full (blends with the input). */
  strength: number;
}

interface ShadowParams {
  color: string;
  opacity: number;
  /** Degrees; 0 = to the right, 90 = downward (direction the shadow is offset). */
  angle: number;
  distance: number;
  blur: number;
}

interface GlowParams {
  color: string;
  opacity: number;
  /** Blur amount in px. */
  blur: number;
  /** Spread (dilation) in px before blurring. */
  spread: number;
}

interface BevelParams {
  /** Bevel width in px. */
  width: number;
  /** Extra blur of the edge in px. */
  softness: number;
  /** Direction the light comes from, degrees (0 = right, 90 = below; -135 = top-left). */
  angle: number;
  /** Opacity of highlight and shade, 0..1. */
  intensity: number;
}

/** Tone curve control point; input level x → output level y, both 0..255. */
export interface CurvePoint {
  x: number;
  y: number;
}

export type CurveChannel = 'rgb' | 'r' | 'g' | 'b';

/** Points sorted by x, at least two each. Each color channel's curve applies first, then rgb. */
export type Curves = Record<CurveChannel, CurvePoint[]>;

/**
 * Live effect (Fireworks-style live filter). An object's effects are applied in list
 * order, each to the result of the previous ones (docs/design.md §3).
 */
export type Effect = EffectCommon &
  (
    | ({ kind: 'drop-shadow' | 'inner-shadow' } & ShadowParams)
    | ({ kind: 'glow' | 'inner-glow' } & GlowParams)
    | ({ kind: 'bevel-inner' } & BevelParams)
    /** Raised rim around the object, filled with `color` and lit like a bevel. */
    | ({ kind: 'bevel-outer'; color: string } & BevelParams)
    /** Relief of the object's edge; without showObject the object turns gray. inset = pressed in. */
    | ({ kind: 'emboss'; showObject: boolean; inset: boolean } & BevelParams)
    | { kind: 'blur'; radius: number }
    /**
     * Zoom blur: streaks outward from a center (box-normalized centerX / centerY).
     * amount = how far the farthest copy is enlarged (0.3 = 130%).
     */
    | { kind: 'zoom-blur'; amount: number; centerX: number; centerY: number }
    /** Unsharp mask: amount 0..5, radius in px. */
    | { kind: 'sharpen'; amount: number; radius: number }
    /** -100..100 each (same scale as the image color adjustments). */
    | { kind: 'brightness-contrast'; brightness: number; contrast: number }
    /** hue -180..180°, saturation and lightness -100..100. */
    | { kind: 'hue-saturation'; hue: number; saturation: number; lightness: number }
    | { kind: 'invert' }
    /** Monochrome tones (same math as the image color adjustment); strength sets how much. */
    | { kind: 'grayscale' }
    | { kind: 'sepia' }
    /** Tone curve (composite RGB plus red / green / blue). */
    | { kind: 'curves'; curves: Curves }
    /** Replaces the colors with `color`, keeping the object's transparency. */
    | { kind: 'color-overlay'; color: string }
  );

export type EffectKind = Effect['kind'];

interface BaseObject {
  id: Id;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  box: Box;
  /** Applied first to last. */
  effects: Effect[];
}

export interface GradientStop {
  /** Position along the gradient, 0..1. Stops may be stored in any order. */
  offset: number;
  color: string;
  opacity: number;
}

/**
 * Gradient fill. `start` / `end` are in box-normalized coordinates of the unrotated box
 * (0..1, may lie outside), so the gradient moves, scales and rotates with the object.
 * - linear: the color runs from start (offset 0) to end (offset 1).
 * - radial: start is the center; end lies on the outer circle (offset 1). In
 *   normalized coordinates it is a circle, so it stretches to an ellipse with the box.
 * - conic: start is the center; offset 0 points toward end and runs clockwise.
 */
export interface Gradient {
  kind: 'linear' | 'radial' | 'conic';
  stops: GradientStop[];
  start: Point;
  end: Point;
}

/** A solid color (#rrggbb) or a gradient. */
export type Fill = string | Gradient;

/** Line style of a stroke. Missing = solid (documents before 2026-10-24). */
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

export interface Paint {
  fill: Fill | null;
  stroke: string | null;
  strokeWidth: number;
  strokeStyle?: StrokeStyle;
}

export type ShapeGeometry =
  | { kind: 'rect'; cornerRadius: number }
  | { kind: 'ellipse' }
  | { kind: 'polygon'; sides: number }
  | { kind: 'star'; points: number; innerRatio: number }
  /** Endpoints in box-normalized coordinates (0..1). */
  | { kind: 'line'; from: Point; to: Point }
  /** Line with an arrow head (older documents; still rendered and editable). */
  | { kind: 'arrow'; from: Point; to: Point; headSize: number }
  /**
   * Filled block arrow pointing to +x in its box (direction comes from the box rotation).
   * shaft: shaft thickness as a fraction of the box height; head: head length as a
   * fraction of the box width. The head spans the full box height.
   */
  | { kind: 'block-arrow'; shaft: number; head: number };

export type ShapeKind = ShapeGeometry['kind'];

export interface ShapeObject extends BaseObject, Paint {
  type: 'shape';
  shape: ShapeGeometry;
}

export interface PathNode {
  /** Anchor in box-normalized coordinates. */
  anchor: Point;
  /** Incoming / outgoing control handles, box-normalized. null = corner. */
  in: Point | null;
  out: Point | null;
}

/** One outline of a (compound) path. */
export interface PathContour {
  nodes: PathNode[];
  closed: boolean;
}

export interface PathObject extends BaseObject, Paint {
  type: 'path';
  /** The first (or only) outline. */
  nodes: PathNode[];
  closed: boolean;
  /**
   * Further outlines of a compound path (results of 型抜き etc.: holes and separate parts;
   * 2026-10-29). Filled with the even-odd rule, so an outline inside another is a hole.
   * Missing in simple paths and older files.
   */
  subpaths?: PathContour[];
}

export interface TextObject extends BaseObject {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: Fill;
  /** Extra spacing between characters in px. */
  letterSpacing: number;
  /** Line height as a multiple of the font size. */
  lineHeight: number;
  align: 'left' | 'center' | 'right';
}

export type ResampleMethod =
  | 'nearest'
  | 'bilinear'
  | 'bicubic'
  | 'lanczos'
  | 'bicubic-sharp'
  | 'bicubic-smooth';

export interface AutoColorParams {
  /** Per-channel black and white points (0..255) for the level stretch. */
  black: [number, number, number];
  white: [number, number, number];
  /**
   * Per-channel gains applied after the stretch. Files from the older gray-world auto
   * color use them; new results keep them at 1 and balance with `gamma` instead.
   */
  gains: [number, number, number];
  /**
   * Per-channel gamma (neutral midtones): out = 255·(x/255)^gamma after the stretch.
   * Missing in older files (= 1).
   */
  gamma?: [number, number, number];
}

export interface ColorAdjust {
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
  temperature: number; // -100..100
  tint: number; // -100..100
  auto: AutoColorParams | null;
}

/** Selection mask shape in image-normalized coordinates (0..1). */
/**
 * Edge treatment of a selection / mask (Fireworks 「エッジ」 and 選択範囲を拡張／縮小).
 * Lengths are in px of the frame the shape lives in: document px for a pixel selection,
 * px of the processed image for an image mask. Missing fields mean the defaults.
 */
export interface MaskEdge {
  /** Outline moved outwards (+) or inwards (−). Default 0. */
  grow?: number;
  /** Anti-aliased (true, default) or hard (false) edge. */
  antialias?: boolean;
  /** Feather width: the edge fades out over this many px. Default 0. */
  feather?: number;
}

export type MaskShape = (
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'ellipse'; x: number; y: number; width: number; height: number }
  | { kind: 'polygon'; points: Point[] }
) &
  MaskEdge;

export interface LocalBlur {
  kind: 'blur';
  radius: number;
  mask: MaskShape;
}

/** Mosaic (pixelation) inside the mask: square blocks of `size` px averaged to one color. */
export interface LocalMosaic {
  kind: 'mosaic';
  /** Block size in px of the processed image; blocks line up with the image's top-left corner. */
  size: number;
  mask: MaskShape;
}

export type LocalEdit = LocalBlur | LocalMosaic;

export interface ImagePipeline {
  /** Crop rectangle in source-image pixels. */
  crop: { x: number; y: number; width: number; height: number } | null;
  resize: { width: number; height: number; method: ResampleMethod } | null;
  adjust: ColorAdjust;
  localEdits: LocalEdit[];
}

export interface ImageObject extends BaseObject {
  type: 'image';
  assetId: AssetId;
  pipeline: ImagePipeline;
}

export interface GroupObject {
  id: Id;
  name: string;
  type: 'group';
  visible: boolean;
  locked: boolean;
  opacity: number;
  /** Children keep document coordinates; the group has no transform of its own. */
  children: SceneObject[];
}

export type LeafObject = ShapeObject | PathObject | TextObject | ImageObject;
export type SceneObject = LeafObject | GroupObject;
export type ObjectType = SceneObject['type'];

export interface Layer {
  id: Id;
  name: string;
  visible: boolean;
  locked: boolean;
  /** First element is drawn first (bottom-most). */
  children: SceneObject[];
}

export interface AssetMeta {
  id: AssetId;
  mimeType: string;
  width: number;
  height: number;
  /** Original file name, informational only. */
  fileName: string;
}

export type Background = { kind: 'transparent' } | { kind: 'color'; color: string };

export interface SparcaDocument {
  version: 1;
  width: number;
  height: number;
  background: Background;
  /** First element is the bottom-most layer. */
  layers: Layer[];
  assets: Record<AssetId, AssetMeta>;
}

export const MAX_DIMENSION = 16384;
export const MAX_PIXELS = 100_000_000;
