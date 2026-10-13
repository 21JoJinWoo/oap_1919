import { useLayoutEffect, useMemo, useRef } from 'react';
import { type InstancedMesh, Matrix4, Quaternion, SphereGeometry, Vector3 } from 'three';
import type { SceneObject } from '../types';

const sphere = new SphereGeometry(1, 24, 16);
const up = new Vector3(0, 1, 0);

/** Deterministic pseudo-random in [0, 1) for bulge jitter. */
const hash = (i: number, k: number) => {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * A bullet's shock-wave trail frozen in time: a chain of stretched, mirror-
 * finished bulges that reflect the environment, swelling towards the bullet
 * and thinning towards the muzzle. One instanced draw call.
 */
export function BulletTrail({ trail, castShadow }: { trail: NonNullable<SceneObject['trail']>; castShadow: boolean }) {
  const mesh = useRef<InstancedMesh>(null);
  const { from, to, count, radius } = trail;

  const matrices = useMemo(() => {
    const a = new Vector3(...to);
    const b = new Vector3(...from);
    const dir = b.clone().sub(a);
    const length = dir.length();
    dir.normalize();
    const side = new Vector3().crossVectors(dir, up).normalize();
    const lift = new Vector3().crossVectors(side, dir).normalize();
    const q = new Quaternion().setFromUnitVectors(up, dir);
    const out: Matrix4[] = [];
    for (let i = 0; i < count; i++) {
      // t: 0 just behind the bullet, 1 at the muzzle. Beads are fullest right behind the bullet (the
      // first one a little smaller so the tip shows) and shrink towards the muzzle.
      const t = i / Math.max(1, count - 1);
      const swell = (i === 0 ? 0.7 : 1) * (1 - 0.75 * Math.pow(t, 0.8));
      const r = radius * (0.22 + 0.78 * swell) * (0.85 + 0.3 * hash(i, 1));
      const wobble = r * 0.3;
      const p = a
        .clone()
        .addScaledVector(dir, t * length)
        .addScaledVector(side, (hash(i, 2) - 0.5) * wobble)
        .addScaledVector(lift, (hash(i, 3) - 0.5) * wobble);
      out.push(new Matrix4().compose(p, q, new Vector3(r, r * (0.9 + 0.35 * hash(i, 4)), r)));
    }
    return out;
  }, [from, to, count, radius]);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    matrices.forEach((mat, i) => m.setMatrixAt(i, mat));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [matrices]);

  return (
    <instancedMesh ref={mesh} args={[sphere, undefined, count]} castShadow={castShadow} frustumCulled={false}>
      <meshPhysicalMaterial color="#eef3f8" metalness={1} roughness={0.04} clearcoat={1} clearcoatRoughness={0.02} envMapIntensity={1.3} />
    </instancedMesh>
  );
}
