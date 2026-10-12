import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { windowFrustum } from '../lib/offAxis';

/**
 * Camera whose frustum always passes through a fixed rectangular window.
 * The camera keeps the window's orientation; only its position (the eye) and
 * the asymmetric frustum bounds change.
 */
export class OffAxisCamera extends PerspectiveCamera {
  /** Window width in world units; height follows the viewport aspect. */
  windowWidth = 6;
  readonly windowCenter = new Vector3();
  readonly windowQuat = new Quaternion();
  /** Eye position in the window's local frame, world units, viewer on +Z. */
  readonly eyeLocal = new Vector3(0, 0, 6);

  constructor() {
    super(50, 1, 0.05, 2000);
  }

  updatePose(): void {
    this.position.copy(this.eyeLocal).applyQuaternion(this.windowQuat).add(this.windowCenter);
    this.quaternion.copy(this.windowQuat);
    this.updateMatrixWorld();
  }

  override updateProjectionMatrix(): void {
    // Called by the base constructor before class fields exist.
    if (!this.eyeLocal) {
      super.updateProjectionMatrix();
      return;
    }
    const f = windowFrustum(this.eyeLocal, this.windowWidth, this.windowWidth / this.aspect, this.near);
    this.projectionMatrix.makePerspective(
      f.left,
      f.right,
      f.top,
      f.bottom,
      this.near,
      this.far,
      this.coordinateSystem,
      this.reversedDepth,
    );
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}
