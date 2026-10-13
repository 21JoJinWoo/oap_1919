import { Clone, useGLTF } from '@react-three/drei';
import { useThree, type ThreeEvent, type RootState } from '@react-three/fiber';
import { Component, memo, Suspense, useMemo, type ReactNode } from 'react';
import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  MathUtils,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { assetUrl } from '../lib/assets';
import { useScene } from '../store/sceneStore';
import { BulletTrail } from './BulletTrail';
import { useDaylight } from './useDaylight';
import type { PrimitiveKind, SceneLight, SceneObject } from '../types';

/** Live Object3D for each object / light id, used by the transform gizmo. */
export const objectRegistry = new Map<string, Object3D>();

const register = (id: string) => (node: Object3D | null) => {
  if (node) objectRegistry.set(id, node);
  else objectRegistry.delete(id);
};

const deg = (v: [number, number, number]) =>
  [MathUtils.degToRad(v[0]), MathUtils.degToRad(v[1]), MathUtils.degToRad(v[2])] as [number, number, number];

// Unit-sized geometry shared by every primitive of the same shape; size comes from `scale`.
const geometryCache = new Map<string, BufferGeometry>();
function primitiveGeometry(kind: PrimitiveKind, segments = 24, arc: [number, number, number] = [0, 0, 360]): BufferGeometry {
  const key = kind === 'ring' ? `ring:${arc.join(',')}` : `${kind}:${segments}`;
  let g = geometryCache.get(key);
  if (!g) {
    switch (kind) {
      case 'box':
        g = new BoxGeometry(1, 1, 1);
        break;
      case 'cylinder':
        g = new CylinderGeometry(0.5, 0.5, 1, segments);
        break;
      case 'cone':
        g = new ConeGeometry(0.5, 1, segments);
        break;
      case 'sphere':
        g = new SphereGeometry(0.5, 24, 16);
        break;
      case 'plane':
        g = new PlaneGeometry(1, 1);
        break;
      case 'ring': {
        const [inner, start, sweep] = arc;
        g = new RingGeometry(inner * 0.5, 0.5, Math.max(8, Math.round(sweep / 4)), 1, (start * Math.PI) / 180, (sweep * Math.PI) / 180);
        break;
      }
      case 'capsule':
        g = new CapsuleGeometry(0.5, 1, 4, 12);
        // CapsuleGeometry(0.5, 1) is 2 units tall; normalise to 1 so scale = size.
        g.scale(1, 0.5, 1);
        break;
    }
    geometryCache.set(key, g);
  }
  return g;
}

function onSelect(type: 'object' | 'light', id: string) {
  return (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (useScene.getState().readOnly) return;
    useScene.getState().select({ type, id });
  };
}

/** One shared KTX2 (Basis) transcoder; it needs the renderer to pick the GPU block format. */
let ktx2: KTX2Loader | null = null;
function ktx2Loader(gl: RootState['gl']) {
  ktx2 ??= new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).detectSupport(gl);
  return ktx2;
}

/** Full anisotropic filtering keeps textures sharp on surfaces seen at a glancing angle (ground, lawns, roofs). */
function sharpenTextures(root: Object3D, anisotropy: number) {
  root.traverse((o) => {
    const mats = (o as Mesh).material;
    if (!mats) return;
    for (const m of Array.isArray(mats) ? mats : [mats]) {
      for (const v of Object.values(m as Material & Record<string, unknown>)) {
        const t = v as Texture | null;
        if (t?.isTexture && t.anisotropy !== anisotropy) {
          t.anisotropy = anisotropy;
          t.needsUpdate = true;
        }
      }
    }
  });
}

function GlbModel({ src, castShadow, receiveShadow }: { src: string; castShadow: boolean; receiveShadow: boolean }) {
  const gl = useThree((s) => s.gl);
  const { scene } = useGLTF(assetUrl(src), false, true, (loader) =>
    // drei's loader comes from three-stdlib; it accepts three's KTX2Loader at runtime.
    loader.setKTX2Loader(ktx2Loader(gl) as unknown as Parameters<typeof loader.setKTX2Loader>[0]),
  );
  useMemo(() => sharpenTextures(scene, gl.capabilities.getMaxAnisotropy()), [scene, gl]);
  // Clone shares geometry and materials with the cached original, so repeated
  // placements of one GLB cost no extra GPU memory.
  return <Clone object={scene} castShadow={castShadow} receiveShadow={receiveShadow} />;
}

class LoadBoundary extends Component<{ children: ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error(`GLB load failed: ${this.props.name}`, err);
  }
  render() {
    return this.state.failed ? <Placeholder color="#ff3b3b" /> : this.props.children;
  }
}

function Placeholder({ color }: { color: string }) {
  return (
    <mesh geometry={primitiveGeometry('box')}>
      <meshBasicMaterial color={color} wireframe />
    </mesh>
  );
}

const ObjectNode = memo(function ObjectNode({ obj }: { obj: SceneObject }) {
  const rotation = useMemo(() => deg(obj.rotation), [obj.rotation]);
  return (
    <group
      ref={register(obj.id)}
      name={obj.id}
      position={obj.position}
      rotation={rotation}
      scale={obj.scale}
      visible={obj.visible}
      onClick={onSelect('object', obj.id)}
    >
      {obj.kind === 'trail' && obj.trail ? (
        <BulletTrail trail={obj.trail} castShadow={obj.castShadow} />
      ) : obj.kind === 'glb' && obj.src ? (
        <LoadBoundary name={obj.name}>
          <Suspense fallback={<Placeholder color="#ff9a40" />}>
            <GlbModel src={obj.src} castShadow={obj.castShadow} receiveShadow={obj.receiveShadow} />
          </Suspense>
        </LoadBoundary>
      ) : (
        <mesh
          geometry={primitiveGeometry(obj.primitive ?? 'box', obj.segments, obj.arc)}
          castShadow={obj.castShadow}
          receiveShadow={obj.receiveShadow}
        >
          <meshStandardMaterial color={obj.color ?? '#cccccc'} roughness={0.9} />
        </mesh>
      )}
    </group>
  );
});

export function SceneObjects() {
  const objects = useScene((s) => s.doc?.objects);
  return <>{objects?.map((o) => <ObjectNode key={o.id} obj={o} />)}</>;
}

const LightNode = memo(function LightNode({
  light,
  shadows,
  showHelpers,
}: {
  light: SceneLight;
  shadows: boolean;
  showHelpers: boolean;
}) {
  const day = useDaylight();
  if (!light.visible) return null;
  // A sun-following light takes its direction, tint and strength from the time of day.
  const sunDriven = !!(light.followSun && day);
  const position = sunDriven ? (day!.direction.map((v) => v * 40) as [number, number, number]) : light.position;
  const color = sunDriven ? day!.sunColor : light.color;
  const intensity = sunDriven ? light.intensity * day!.sun : light.intensity;
  const cast = shadows && light.castShadow && intensity > 0;
  return (
    <group ref={register(light.id)} name={light.id} position={position}>
      {light.kind === 'ambient' && <ambientLight color={light.color} intensity={light.intensity} />}
      {light.kind === 'hemisphere' && (
        <hemisphereLight args={[light.color, light.groundColor ?? '#444444', light.intensity]} />
      )}
      {light.kind === 'directional' && (
        <directionalLight
          color={color}
          intensity={intensity}
          castShadow={cast}
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0005}
          shadow-normalBias={0.06}
          shadow-camera-left={-40}
          shadow-camera-right={40}
          shadow-camera-top={40}
          shadow-camera-bottom={-40}
          shadow-camera-near={0.5}
          shadow-camera-far={150}
        />
      )}
      {light.kind === 'point' && (
        <pointLight color={light.color} intensity={light.intensity} castShadow={cast} distance={0} decay={2} />
      )}
      {showHelpers && light.kind !== 'ambient' && (
        <mesh onClick={onSelect('light', light.id)}>
          <sphereGeometry args={[0.6, 12, 8]} />
          <meshBasicMaterial color={light.color} wireframe />
        </mesh>
      )}
    </group>
  );
});

export function SceneLights({ showHelpers }: { showHelpers: boolean }) {
  const lights = useScene((s) => s.doc?.lights);
  const shadows = useScene((s) => s.doc?.settings.shadows ?? true);
  return <>{lights?.map((l) => <LightNode key={l.id} light={l} shadows={shadows} showHelpers={showHelpers} />)}</>;
}
