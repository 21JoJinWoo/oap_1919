// Latest eye position in metres relative to the screen centre (x right, y up,
// z towards the viewer). Mutated by the tracker every video frame and read by
// the render loop; kept outside React to avoid re-rendering per frame.

export type PoseSource = 'camera' | 'mouse';

export const headPose = {
  x: 0,
  y: 0,
  z: 0.6,
  source: 'mouse' as PoseSource,
  faceVisible: false,
  /** performance.now() of the last accepted face sample. */
  lastSeen: 0,
};

/** Resets the eye to the neutral position in front of the screen centre. */
export function neutralPose(distanceM: number): void {
  headPose.x = 0;
  headPose.y = 0;
  headPose.z = distanceM;
}
