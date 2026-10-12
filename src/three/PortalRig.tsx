import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo } from 'react';
import { Euler, MathUtils, Quaternion } from 'three';
import { useScene } from '../store/sceneStore';
import { useUi } from '../store/uiStore';
import { headPose } from '../tracking/headPose';
import { OffAxisCamera } from './OffAxisCamera';

/** Pointer position in normalised device coordinates, for mouse mode. */
const pointer = { x: 0, y: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
  });
}

/** How long a lost face keeps its last pose before easing back to centre. */
const FACE_HOLD_MS = 1200;

const euler = new Euler();
const quat = new Quaternion();

/** Installs an off-axis camera as the default camera and drives it from `headPose`. */
export function PortalRig() {
  const set = useThree((s) => s.set);
  const get = useThree((s) => s.get);
  const camera = useMemo(() => new OffAxisCamera(), []);

  useLayoutEffect(() => {
    const prev = get().camera;
    const { width, height } = get().size;
    camera.aspect = width / height;
    set({ camera });
    return () => set({ camera: prev });
  }, [camera, get, set]);

  useFrame((_, delta) => {
    const doc = useScene.getState().doc;
    if (!doc) return;
    const { portal, viewer } = doc.settings;
    const screenW = viewer.screenWidthCm / 100;
    const screenH = screenW / camera.aspect;
    const restZ = viewer.defaultDistanceCm / 100;

    const ui = useUi.getState();
    const useCamera = !ui.mouseMode && ui.tracker === 'running';
    headPose.source = useCamera ? 'camera' : 'mouse';
    const ease = 1 - Math.exp(-delta * 6);
    if (!useCamera) {
      // Mouse mode: the pointer stands in for the head, within the screen bounds.
      headPose.x = MathUtils.lerp(headPose.x, (pointer.x * screenW) / 2, ease);
      headPose.y = MathUtils.lerp(headPose.y, (pointer.y * screenH) / 2, ease);
      headPose.z = MathUtils.lerp(headPose.z, restZ, ease);
    } else if (performance.now() - headPose.lastSeen > FACE_HOLD_MS) {
      headPose.x = MathUtils.lerp(headPose.x, 0, ease * 0.5);
      headPose.y = MathUtils.lerp(headPose.y, 0, ease * 0.5);
      headPose.z = MathUtils.lerp(headPose.z, restZ, ease * 0.5);
    }

    // Physical metres -> world units: the screen maps onto the portal window.
    const k = portal.width / screenW;
    camera.windowWidth = portal.width;
    camera.windowCenter.fromArray(portal.center);
    camera.windowQuat.copy(quat.setFromEuler(euler.set(0, MathUtils.degToRad(portal.yawDeg), 0)));
    camera.eyeLocal.set(headPose.x * viewer.parallax * k, headPose.y * viewer.parallax * k, headPose.z * k);
    camera.near = Math.min(0.05, camera.eyeLocal.z * 0.5);
    camera.updatePose();
    camera.updateProjectionMatrix();
  });

  return null;
}
