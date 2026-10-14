import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, CylinderGeometry, type InstancedMesh, Matrix4, Quaternion, SphereGeometry, Vector3 } from 'three';
import type { SceneObject } from '../types';

const sphere = new SphereGeometry(1, 24, 16);
const streakGeo = new CylinderGeometry(1, 1, 1, 6, 1, true);
const up = new Vector3(0, 1, 0);

/** Deterministic pseudo-random in [0, 1) for bulge jitter. */
const hash = (i: number, k: number) => {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const m4 = new Matrix4();
const pos = new Vector3();
const scl = new Vector3();

/**
 * A bullet's shock-wave trail: a chain of stretched, mirror-finished bulges that reflect the
 * environment, swelling towards the bullet and thinning towards the muzzle. With `flow` the beads
 * stream back from the bullet towards the muzzle (cycles per second) — the air rushing past a
 * bullet in flight — and faint speed streaks race along it. One instanced draw call each.
 */
export function BulletTrail({ trail, castShadow }: { trail: NonNullable<SceneObject['trail']>; castShadow: boolean }) {
  const beads = useRef<InstancedMesh>(null);
  const streaks = useRef<InstancedMesh>(null);
  const { from, to, count, radius } = trail;
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

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const { a, dir, length, side, lift, q } = frame;
    const m = beads.current;
    if (m) {
      for (let i = 0; i < count; i++) {
        // t: 0 just behind the bullet, 1 at the muzzle. With flow, bead 0 stays seated behind the
        // bullet and the rest drift back and wrap, growing out of the wake instead of popping in.
        const moving = flow > 0 && i > 0;
        const t = moving ? 0.02 + 0.98 * (((i - 1) / (count - 1) + time * flow) % 1) : i / Math.max(1, count - 1);
        const swell = 1 - 0.75 * Math.pow(t, 0.8);
        const emerge = moving ? 0.35 + 0.65 * smooth(0.02, 0.1, t) : i === 0 ? 0.7 : 1;
        const breathe = flow ? 1 + 0.06 * Math.sin(time * 9 + i * 1.7) : 1;
        const r = radius * (0.22 + 0.78 * swell) * (0.85 + 0.3 * hash(i, 1)) * emerge * breathe;
        const wobble = r * 0.3;
        pos.copy(a).addScaledVector(dir, t * length).addScaledVector(side, (hash(i, 2) - 0.5) * wobble).addScaledVector(lift, (hash(i, 3) - 0.5) * wobble);
        scl.set(r, r * (0.9 + 0.35 * hash(i, 4)), r);
        m.setMatrixAt(i, m4.compose(pos, q, scl));
      }
      m.instanceMatrix.needsUpdate = true;
    }
    const s = streaks.current;
    if (s) {
      for (let i = 0; i < streakCount; i++) {
        // Streaks run faster than the beads and fade (thin out) towards the muzzle.
        const t = (hash(i, 5) + time * flow * 2.3) % 1;
        const ang = hash(i, 6) * Math.PI * 2;
        const rr = radius * (1.4 + 2.2 * hash(i, 7)) * (1 - 0.5 * t);
        const len = (0.12 + 0.25 * hash(i, 8)) * (1 - 0.6 * t);
        const thick = 0.0012 * smooth(0, 0.08, t) * (1 - t);
        pos.copy(a).addScaledVector(dir, t * length + len / 2).addScaledVector(side, Math.cos(ang) * rr).addScaledVector(lift, Math.sin(ang) * rr);
        s.setMatrixAt(i, m4.compose(pos, q, scl.set(thick, len, thick)));
      }
      s.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={beads} args={[sphere, undefined, count]} castShadow={castShadow} frustumCulled={false}>
        <meshPhysicalMaterial color="#eef3f8" metalness={1} roughness={0.04} clearcoat={1} clearcoatRoughness={0.02} envMapIntensity={1.3} />
      </instancedMesh>
      {streakCount > 0 && (
        <instancedMesh ref={streaks} args={[streakGeo, undefined, streakCount]} frustumCulled={false} renderOrder={3}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0.18} blending={AdditiveBlending} depthWrite={false} />
        </instancedMesh>
      )}
    </>
  );
}
