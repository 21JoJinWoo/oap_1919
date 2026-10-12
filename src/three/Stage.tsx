import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, type RootState } from '@react-three/fiber';
import { useState } from 'react';
import { useScene } from '../store/sceneStore';
import { EditorRig, PortalGizmo, StatsProbe, TransformGizmo } from './EditTools';
import { PortalRig } from './PortalRig';
import { SceneLights, SceneObjects } from './SceneObjects';

const MAX_DPR = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio, 2);

function Atmosphere() {
  const background = useScene((s) => s.doc?.settings.background ?? '#000000');
  const fog = useScene((s) => s.doc?.settings.fog);
  return (
    <>
      <color attach="background" args={[background]} />
      {fog?.enabled && <fog attach="fog" args={[fog.color, fog.near, fog.far]} />}
    </>
  );
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
