// Sparca document data model. See docs/design.md §2.

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

export interface GlowEffect {
  enabled: boolean;
  color: string;
  /** Blur amount in px. */
  blur: number;
  /** Spread (dilation) in px before blurring. */
  spread: number;
  opacity: number;
}

export interface DropShadowEffect {
  enabled: boolean;
  color: string;
  opacity: number;
  /** Degrees; 0 = to the right, 90 = downward. */
  angle: number;
  distance: number;
  blur: number;
}

export interface Effects {
  glow: GlowEffect;
  dropShadow: DropShadowEffect;
}

interface BaseObject {
  id: Id;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  box: Box;
  effects: Effects;
}

export interface Paint {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
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

export interface PathObject extends BaseObject, Paint {
  type: 'path';
  nodes: PathNode[];
  closed: boolean;
}

export interface TextObject extends BaseObject {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
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
  /** Gray-world white balance gains applied after the stretch. */
  gains: [number, number, number];
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
export type MaskShape =
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'ellipse'; x: number; y: number; width: number; height: number }
  | { kind: 'polygon'; points: Point[] };

export interface LocalBlur {
  kind: 'blur';
  radius: number;
  mask: MaskShape;
}

export type LocalEdit = LocalBlur;

export interface ImagePipeline {
  /** Crop rectangle in source-image pixels. */
  crop: { x: number; y: number; width: number; height: number } | null;
  resize: { width: number; height: number; method: ResampleMethod } | null;
  adjust: ColorAdjust;
  /** Whole-image gaussian blur radius in px. */
  blur: number;
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
