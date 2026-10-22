import type {
  AssetMeta,
  Box,
  ColorAdjust,
  Effect,
  GroupObject,
  ImageObject,
  ImagePipeline,
  Layer,
  PathNode,
  PathObject,
  SceneObject,
  ShapeGeometry,
  ShapeObject,
  SparcaDocument,
  TextObject,
} from './types';

let counter = 0;

/** Unique id; random part keeps ids unique across sessions and loaded projects. */
export function newId(prefix = 'o'): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

/** New objects start without effects. */
export function defaultEffects(): Effect[] {
  return [];
}

export function defaultAdjust(): ColorAdjust {
  return { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, auto: null, tone: 'none', toneAmount: 100 };
}

export function defaultPipeline(): ImagePipeline {
  return { crop: null, resize: null, adjust: defaultAdjust(), blur: 0, localEdits: [] };
}

export function createDocument(width = 800, height = 600): SparcaDocument {
  return {
    version: 1,
    width,
    height,
    background: { kind: 'color', color: '#ffffff' },
    layers: [createLayer('レイヤー 1')],
    assets: {},
  };
}

export function createLayer(name: string): Layer {
  return { id: newId('l'), name, visible: true, locked: false, children: [] };
}

const SHAPE_NAMES: Record<ShapeGeometry['kind'], string> = {
  rect: '矩形',
  ellipse: '楕円',
  polygon: '多角形',
  star: '星',
  line: '直線',
  arrow: '矢印',
  'block-arrow': '矢印',
};

export function createShape(shape: ShapeGeometry, box: Box): ShapeObject {
  return {
    id: newId(),
    name: SHAPE_NAMES[shape.kind],
    type: 'shape',
    visible: true,
    locked: false,
    opacity: 1,
    box,
    effects: defaultEffects(),
    shape,
    ...shapePaint(shape.kind),
  };
}

function shapePaint(kind: ShapeGeometry['kind']): Pick<ShapeObject, 'fill' | 'stroke' | 'strokeWidth'> {
  if (kind === 'line' || kind === 'arrow') return { fill: null, stroke: '#222222', strokeWidth: 3 };
  // Annotation-style arrow: yellow with a black outline.
  if (kind === 'block-arrow') return { fill: '#ffe100', stroke: '#000000', strokeWidth: 4 };
  return { fill: '#4a90e2', stroke: null, strokeWidth: 0 };
}

export function defaultGeometry(kind: ShapeGeometry['kind']): ShapeGeometry {
  switch (kind) {
    case 'rect':
      return { kind: 'rect', cornerRadius: 0 };
    case 'ellipse':
      return { kind: 'ellipse' };
    case 'polygon':
      return { kind: 'polygon', sides: 6 };
    case 'star':
      return { kind: 'star', points: 5, innerRatio: 0.45 };
    case 'line':
      return { kind: 'line', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } };
    case 'arrow':
      return { kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, headSize: 14 };
    case 'block-arrow':
      return { kind: 'block-arrow', shaft: 0.5, head: 0.45 };
  }
}

export function createPath(nodes: PathNode[], closed: boolean, box: Box): PathObject {
  return {
    id: newId(),
    name: 'パス',
    type: 'path',
    visible: true,
    locked: false,
    opacity: 1,
    box,
    effects: defaultEffects(),
    nodes,
    closed,
    fill: closed ? '#4a90e2' : null,
    stroke: '#222222',
    strokeWidth: 2,
  };
}

export function createText(text: string, box: Box): TextObject {
  return {
    id: newId(),
    name: 'テキスト',
    type: 'text',
    visible: true,
    locked: false,
    opacity: 1,
    box,
    effects: defaultEffects(),
    text,
    fontFamily: 'sans-serif',
    fontSize: 32,
    bold: false,
    italic: false,
    color: '#222222',
    letterSpacing: 0,
    lineHeight: 1.2,
    align: 'left',
  };
}

export function createImage(asset: AssetMeta, box: Box): ImageObject {
  return {
    id: newId(),
    name: asset.fileName || '画像',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    box,
    effects: defaultEffects(),
    assetId: asset.id,
    pipeline: defaultPipeline(),
  };
}

export function createGroup(children: SceneObject[]): GroupObject {
  return {
    id: newId('g'),
    name: 'グループ',
    type: 'group',
    visible: true,
    locked: false,
    opacity: 1,
    children,
  };
}
