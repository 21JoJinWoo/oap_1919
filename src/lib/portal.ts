import type { SceneSettings } from '../types';

/**
 * Converts a physical eye position (metres from the screen centre) into the
 * portal window's local frame, in world units. The screen maps onto a window
 * `portal.width` wide; `fovScale` > 1 brings the eye closer for a wider view.
 * `zoomOut` divides only the depth: a viewer standing N times farther away
 * (exhibition) sees the same field of view and parallax as at the near screen.
 */
export function eyeInWindow(
  { portal, viewer }: Pick<SceneSettings, 'portal' | 'viewer'>,
  pose: { x: number; y: number; z: number },
  zoomOut = 1,
): { x: number; y: number; z: number } {
  const k = portal.width / (viewer.screenWidthCm / 100);
  const sx = viewer.invertX ? -1 : 1;
  const sy = viewer.invertY ? -1 : 1;
  return {
    x: sx * pose.x * viewer.parallax * k,
    y: sy * pose.y * viewer.parallax * k + (portal.eyeOffsetY ?? 0),
    z: (pose.z * k) / ((portal.fovScale ?? 1) * zoomOut),
  };
}
