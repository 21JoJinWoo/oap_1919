import { Line, OrbitControls, PerspectiveCamera, TransformControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MathUtils, type Mesh, type Object3D } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { eyeInWindow } from '../lib/portal';
import { useScene } from '../store/sceneStore';
import { useUi } from '../store/uiStore';
import { headPose } from '../tracking/headPose';
import type { Vec3 } from '../types';
import { objectRegistry } from './SceneObjects';

const round = (n: number, p = 1000) => Math.round(n * p) / p;
const toVec3 = (v: { x: number; y: number; z: number }, p?: number): Vec3 => [round(v.x, p), round(v.y, p), round(v.z, p)];

/** Gizmo for moving / rotating / scaling the selected object or light. */
export function TransformGizmo() {
  const selection = useScene((s) => s.selection);
  const mode = useScene((s) => s.transformMode);
  const readOnly = useScene((s) => s.readOnly);
  // Re-resolve the target whenever the scene graph may have changed.
  const objects = useScene((s) => s.doc?.objects);
  const lights = useScene((s) => s.doc?.lights);
  const [target, setTarget] = useState<Object3D | null>(null);

  useEffect(() => {
    setTarget(selection ? (objectRegistry.get(selection.id) ?? null) : null);
  }, [selection, objects, lights]);

  if (!selection || !target || readOnly) return null;
  const isLight = selection.type === 'light';

  const commit = () => {
    const { updateObject, updateLight } = useScene.getState();
    if (isLight) {
      updateLight(selection.id, { position: toVec3(target.position) });
      return;
    }
    const r = target.rotation;
    updateObject(selection.id, {
      position: toVec3(target.position),
      rotation: [round(MathUtils.radToDeg(r.x), 100), round(MathUtils.radToDeg(r.y), 100), round(MathUtils.radToDeg(r.z), 100)],
      scale: toVec3(target.scale),
    });
  };

  return <TransformControls object={target} mode={isLight ? 'translate' : mode} size={0.9} onMouseUp={commit} />;
}

/** Last free-camera pose, kept across mode switches. */
let editPose: { position: Vec3; target: Vec3 } | null = null;

/** Free orbit camera for EDIT mode. */
export function EditorRig() {
  const doc = useScene.getState().doc;
  const controls = useRef<OrbitControlsImpl>(null);
  const initial = useMemo(() => {
    if (editPose) return editPose;
    const c = doc?.settings.portal.center ?? [0, 1.6, 9];
    return { position: [c[0] + 6, c[1] + 8, c[2] + 14] as Vec3, target: [c[0], 1, c[2] - 10] as Vec3 };
  }, [doc]);

  useEffect(
    () => () => {
      const c = controls.current;
      if (c) editPose = { position: toVec3(c.object.position), target: toVec3(c.target) };
    },
    [],
  );

  return (
    <>
      <PerspectiveCamera makeDefault position={initial.position} fov={50} near={0.1} far={2000} />
      <OrbitControls ref={controls} makeDefault target={initial.target} enableDamping dampingFactor={0.12} />
    </>
  );
}

/** Shows the portal window, the tracked eye and the view frustum in EDIT mode. */
export function PortalGizmo() {
  const portal = useScene((s) => s.doc?.settings.portal);
  const viewer = useScene((s) => s.doc?.settings.viewer);
  const size = useThree((s) => s.size);
  const eye = useRef<Mesh>(null);

  const frame = useMemo(() => {
    if (!portal) return null;
    const w = portal.width / 2;
    const h = portal.width / (size.width / size.height) / 2;
    const corners: Vec3[] = [
      [-w, -h, 0],
      [w, -h, 0],
      [w, h, 0],
      [-w, h, 0],
    ];
    return { corners, w, h };
  }, [portal, size.width, size.height]);

  useFrame(() => {
    if (!eye.current || !portal || !viewer) return;
    const e = eyeInWindow({ portal, viewer }, headPose);
    eye.current.position.set(e.x, e.y, e.z);
  });

  if (!portal || !viewer || !frame) return null;
  // Rays from the neutral eye through each window corner, out to `depth` behind the window.
  const depth = 60;
  const rest = eyeInWindow({ portal, viewer }, { x: 0, y: 0, z: viewer.defaultDistanceCm / 100 });
  const spread = 1 + depth / rest.z;
  return (
    <group position={portal.center} rotation={[0, MathUtils.degToRad(portal.yawDeg), 0]}>
      <Line points={[...frame.corners, frame.corners[0]]} color="#ff6a00" lineWidth={2} />
      {frame.corners.map((c, i) => (
        <Line
          key={i}
          points={[c, [c[0] + (c[0] - rest.x) * (spread - 1), c[1] + (c[1] - rest.y) * (spread - 1), -depth]]}
          color="#ff6a00"
          lineWidth={1}
          transparent
          opacity={0.25}
        />
      ))}
      <mesh ref={eye}>
        <sphereGeometry args={[0.25, 16, 12]} />
        <meshBasicMaterial color="#50ff8c" />
      </mesh>
    </group>
  );
}

/** Publishes renderer statistics to the UI store a few times per second. */
export function StatsProbe() {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ frames: 0, since: performance.now() });
  useFrame(() => {
    const a = acc.current;
    a.frames++;
    const now = performance.now();
    if (now - a.since < 500) return;
    const info = gl.info;
    useUi.getState().set({
      stats: {
        fps: Math.round((a.frames * 1000) / (now - a.since)),
        calls: info.render.calls,
        triangles: info.render.triangles,
        textures: info.memory.textures,
        geometries: info.memory.geometries,
      },
    });
    a.frames = 0;
    a.since = now;
  });
  return null;
}
