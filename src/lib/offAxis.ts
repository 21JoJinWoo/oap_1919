// Off-axis (asymmetric frustum) projection for a flat, axis-aligned window.
// Equivalent to Kooima, "Generalized Perspective Projection" (2008), for the
// case where the window is the camera's own image plane: the camera keeps the
// window's orientation and only the frustum bounds shift with the eye.

export interface Frustum {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * @param eye eye position in the window's local frame (window centred at the
 *   origin, spanning x∈[-w/2,w/2], y∈[-h/2,h/2], viewer on +Z).
 * @param near near-plane distance from the eye.
 */
export function windowFrustum(
  eye: { x: number; y: number; z: number },
  width: number,
  height: number,
  near: number,
): Frustum {
  const d = Math.max(eye.z, 1e-4);
  const k = near / d;
  return {
    left: (-width / 2 - eye.x) * k,
    right: (width / 2 - eye.x) * k,
    bottom: (-height / 2 - eye.y) * k,
    top: (height / 2 - eye.y) * k,
  };
}

export interface FaceSample {
  /** Eye midpoint in normalised image coordinates (0..1, origin top-left, un-mirrored). */
  u: number;
  v: number;
  /** Distance between the two eye keypoints in normalised x units. */
  eyeDistX: number;
  eyeDistY: number;
}

/** Mean adult interpupillary distance in metres (Dodgson 2004: ~63 mm). */
export const MEAN_IPD_M = 0.063;

/**
 * Converts a face detection into an eye position in metres relative to the
 * centre of the screen (x right, y up, z towards the viewer). The webcam is
 * assumed to sit at the top-centre of the screen, facing the viewer.
 */
export function faceToEye(
  s: FaceSample,
  video: { width: number; height: number },
  webcamFovDeg: number,
  screenHeightM: number,
): { x: number; y: number; z: number } {
  const f = video.width / 2 / Math.tan((webcamFovDeg * Math.PI) / 360);
  const ipdPx = Math.hypot(s.eyeDistX * video.width, s.eyeDistY * video.height);
  const z = (MEAN_IPD_M * f) / Math.max(ipdPx, 1);
  // The raw webcam image is mirrored relative to the viewer: moving to your
  // right moves your face towards the image's left edge.
  const x = (-(s.u - 0.5) * video.width * z) / f;
  const y = (-(s.v - 0.5) * video.height * z) / f + screenHeightM / 2;
  return { x, y, z };
}
