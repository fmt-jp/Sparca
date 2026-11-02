// Gradient masks (types.ts ObjectMask): defaults and the frame the gradient is normalized to.
import { defaultGeometry } from './gradient';
import { unionBounds } from './geometry';
import type { Box, Gradient, ObjectMask, SceneObject } from './types';

/**
 * The box a mask's gradient is normalized to: the object's box, or for a group its mask
 * frame (or, before it has a mask, the bounds of its children).
 */
export function maskFrame(o: SceneObject): Box | null {
  if (o.type !== 'group') return o.box;
  if (o.mask?.frame) return o.mask.frame;
  const b = unionBounds(o.children);
  return b ? { ...b, rotation: 0 } : null;
}

/** A new mask: white (shows) on the left fading to black (hidden) on the right. */
export function newGradientMask(o: SceneObject): ObjectMask | null {
  const frame = maskFrame(o);
  if (!frame) return null;
  const gradient: Gradient = {
    kind: 'linear',
    ...defaultGeometry('linear'),
    stops: [
      { offset: 0, color: '#ffffff', opacity: 1 },
      { offset: 1, color: '#000000', opacity: 1 },
    ],
  };
  return { gradient, enabled: true, ...(o.type === 'group' ? { frame } : {}) };
}
