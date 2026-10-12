import type { SceneSettings } from '../types';

/**
 * Converts a physical eye position (metres from the screen centre) into the
 * portal window's local frame, in world units. The screen maps onto a window
 * `portal.width` wide; `fovScale` > 1 brings the eye closer for a wider view.
 */
export function eyeInWindow(
  { portal, viewer }: Pick<SceneSettings, 'portal' | 'viewer'>,
  pose: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const k = portal.width / (viewer.screenWidthCm / 100);
  return {
    x: pose.x * viewer.parallax * k,
    y: pose.y * viewer.parallax * k + (portal.eyeOffsetY ?? 0),
    z: (pose.z * k) / (portal.fovScale ?? 1),
  };
}
