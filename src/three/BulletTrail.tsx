import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, CylinderGeometry, type InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { SceneObject } from '../types';

const streakGeo = new CylinderGeometry(1, 1, 1, 6, 1, true);
const up = new Vector3(0, 1, 0);

/** Deterministic pseudo-random in [0, 1). */
const hash = (i: number, k: number) => {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Speed streaks racing back along a bullet's path. The wake and shock cone themselves are drawn
 * as a screen-space heat-haze distortion (see WakeDistortion in Cinematic.tsx), since air has no
 * surface of its own — only the background seen through it ripples.
 */
export function BulletTrail({ trail }: { trail: NonNullable<SceneObject['trail']>; castShadow: boolean }) {
  const streaks = useRef<InstancedMesh>(null);
  const { from, to, radius } = trail;
  const flow = trail.flow ?? 0;
  const streakCount = trail.streaks ?? 0;
  const frame = useMemo(() => {
    const a = new Vector3(...to);
    const dir = new Vector3(...from).sub(a);
    const length = dir.length();
    dir.normalize();
    const side = new Vector3().crossVectors(dir, up).normalize();
    const lift = new Vector3().crossVectors(side, dir).normalize();
    return { a, dir, length, side, lift, q: new Quaternion().setFromUnitVectors(up, dir) };
  }, [from, to]);

  const m4 = useMemo(() => new Matrix4(), []);
  const pos = useMemo(() => new Vector3(), []);
  const scl = useMemo(() => new Vector3(), []);
  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const s = streaks.current;
    if (!s) return;
    const { a, dir, length, side, lift, q } = frame;
    for (let i = 0; i < streakCount; i++) {
      // Streaks race back faster than the ripples and thin out towards the muzzle.
      const t = (hash(i, 5) + time * flow * 2.3) % 1;
      const ang = hash(i, 6) * Math.PI * 2;
      const rr = radius * (1.4 + 2.2 * hash(i, 7)) * (1 - 0.5 * t);
      const len = (0.12 + 0.25 * hash(i, 8)) * (1 - 0.6 * t);
      const thick = 0.0012 * smooth(0, 0.08, t) * (1 - t);
      pos.copy(a).addScaledVector(dir, t * length + len / 2).addScaledVector(side, Math.cos(ang) * rr).addScaledVector(lift, Math.sin(ang) * rr);
      s.setMatrixAt(i, m4.compose(pos, q, scl.set(thick, len, thick)));
    }
    s.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      {streakCount > 0 && (
        <instancedMesh ref={streaks} args={[streakGeo, undefined, streakCount]} frustumCulled={false} renderOrder={3}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0.12} blending={AdditiveBlending} depthWrite={false} />
        </instancedMesh>
      )}
    </>
  );
}
