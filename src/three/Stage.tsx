import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, useLoader, useThree, type RootState } from '@react-three/fiber';
import { Suspense, useLayoutEffect, useState } from 'react';
import { EquirectangularReflectionMapping, SRGBColorSpace, TextureLoader } from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { assetUrl } from '../lib/assets';
import type { SceneSettings } from '../types';
import { useScene } from '../store/sceneStore';
import { EditorRig, PortalGizmo, StatsProbe, TransformGizmo } from './EditTools';
import { PortalRig } from './PortalRig';
import { SceneLights, SceneObjects } from './SceneObjects';
import { useDaylight } from './useDaylight';

const MAX_DPR = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio, 2);

function Atmosphere() {
  const background = useScene((s) => s.doc?.settings.background ?? '#000000');
  const fog = useScene((s) => s.doc?.settings.fog);
  const env = useScene((s) => s.doc?.settings.environment);
  const day = useDaylight();
  const flat = <color attach="background" args={[background]} />;
  return (
    <>
      {env ? (
        <Suspense fallback={flat}>
          <HdriEnvironment env={env} sky={day?.sky ?? 1} />
        </Suspense>
      ) : (
        flat
      )}
      {fog?.enabled && <fog attach="fog" args={[day?.fogColor ?? fog.color, fog.near, fog.far]} />}
    </>
  );
}

/** HDR image-based lighting plus a pre-tone-mapped sky backdrop (sRGB, so three.js skips tone mapping it). */
function HdriEnvironment({ env, sky: skyLevel }: { env: NonNullable<SceneSettings['environment']>; sky: number }) {
  const hdr = useLoader(HDRLoader, assetUrl(env.hdr));
  const sky = useLoader(TextureLoader, assetUrl(env.sky));
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    hdr.mapping = EquirectangularReflectionMapping;
    sky.mapping = EquirectangularReflectionMapping;
    sky.colorSpace = SRGBColorSpace;
    scene.environment = hdr;
    scene.background = sky;
    scene.environmentIntensity = env.intensity * skyLevel;
    scene.backgroundIntensity = skyLevel;
    gl.toneMappingExposure = env.exposure;
    return () => {
      scene.environment = null;
      scene.background = null;
      scene.backgroundIntensity = 1;
      gl.toneMappingExposure = 1;
    };
  }, [hdr, sky, scene, gl, env.intensity, env.exposure, skyLevel]);
  return null;
}

export function Stage({ onCreated }: { onCreated?: (state: RootState) => void }) {
  const mode = useScene((s) => s.mode);
  const select = useScene((s) => s.select);
  // Adaptive resolution: drop the pixel ratio when the frame rate falls.
  const [dpr, setDpr] = useState(MAX_DPR);

  return (
    <Canvas
      shadows="percentage"
      dpr={dpr}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={onCreated}
      onPointerMissed={() => select(null)}
    >
      <PerformanceMonitor
        onDecline={() => setDpr((d) => Math.max(1, d - 0.25))}
        onIncline={() => setDpr((d) => Math.min(MAX_DPR, d + 0.25))}
      />
      <Atmosphere />
      {mode === 'spatial' ? <PortalRig /> : <EditorRig />}
      {mode === 'edit' && <PortalGizmo />}
      <SceneLights showHelpers={mode === 'edit'} />
      <SceneObjects />
      <TransformGizmo />
      <StatsProbe />
    </Canvas>
  );
}
