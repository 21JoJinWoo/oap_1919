import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SRGBColorSpace,
  Euler,
  Vector3,
} from 'three';
import type { SceneObject, Vec3 } from '../types';
import { useDaylight } from './useDaylight';

type Fx = NonNullable<SceneObject['fx']>;

/** Seeded pseudo-random stream (mulberry32), so a frozen moment looks the same on every load. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

/** Soft billow: value-noise fBm under a radial falloff, white with alpha. */
const smokeTexture = (() => {
  let tex: CanvasTexture | null = null;
  return () => {
    if (tex) return tex;
    const N = 128;
    const [c, g] = canvas(N, N);
    const r = rng(7);
    const grid = Array.from({ length: 17 * 17 }, r);
    const noise = (x: number, y: number) => {
      const xi = Math.floor(x) % 16, yi = Math.floor(y) % 16, xf = x - Math.floor(x), yf = y - Math.floor(y);
      const s = (t: number) => t * t * (3 - 2 * t);
      const v = (i: number, j: number) => grid[((yi + j) % 16) * 17 + ((xi + i) % 16)];
      return (v(0, 0) * (1 - s(xf)) + v(1, 0) * s(xf)) * (1 - s(yf)) + (v(0, 1) * (1 - s(xf)) + v(1, 1) * s(xf)) * s(yf);
    };
    const img = g.createImageData(N, N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const u = x / N, v = y / N;
        let f = 0, amp = 0.5, fr = 4;
        for (let o = 0; o < 4; o++, amp *= 0.5, fr *= 2) f += amp * noise(u * fr, v * fr);
        const d = Math.hypot(u - 0.5, v - 0.5) * 2;
        const a = Math.max(0, 1 - d) ** 1.6 * Math.min(1, Math.max(0, (f - 0.25) * 1.8));
        const i = (y * N + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    g.putImageData(img, 0, 0);
    tex = new CanvasTexture(c);
    return tex;
  };
})();

/** Printed sheet: off-white paper with vertical columns of type, read right to left. */
const leafletTexture = (() => {
  let tex: CanvasTexture | null = null;
  return () => {
    if (tex) return tex;
    const [c, g] = canvas(256, 360);
    const r = rng(19);
    g.fillStyle = '#e9e1cf';
    g.fillRect(0, 0, 256, 360);
    g.fillStyle = 'rgba(120,100,70,0.12)';
    for (let i = 0; i < 400; i++) g.fillRect(r() * 256, r() * 360, 2, 2);
    g.fillStyle = '#4a4034';
    g.font = 'bold 20px serif';
    g.fillText('宣言書', 196, 34); // title, top right
    g.fillStyle = 'rgba(60,50,40,0.75)';
    for (let col = 0; col < 14; col++) {
      const x = 226 - col * 15;
      for (let y = 52; y < 336; y += 11) if (r() > 0.1) g.fillRect(x + r(), y, 7 + r() * 2, 6 + r() * 2);
    }
    tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  };
})();

/** Round soft speck for dust. */
const dustTexture = (() => {
  let tex: CanvasTexture | null = null;
  return () => {
    if (tex) return tex;
    const [c, g] = canvas(32, 32);
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    tex = new CanvasTexture(c);
    return tex;
  };
})();

const BILLBOARD_VERT = /* glsl */ `
attribute vec3 aCenter;
attribute float aSize;
attribute float aRot;
attribute float aAlpha;
attribute float aShade;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  vShade = aShade;
  vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
  float c = cos(aRot), s = sin(aRot);
  mv.xy += mat2(c, s, -s, c) * position.xy * aSize;
  gl_Position = projectionMatrix * mv;
}
`;
const SMOKE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 litColor;
uniform vec3 shadeColor;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
void main() {
  float a = texture2D(map, vUv).a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(shadeColor, litColor, vShade), a);
}
`;

interface Billboard {
  center: [number, number, number];
  size: number;
  rot: number;
  alpha: number;
  shade: number;
}

function billboardGeometry(items: Billboard[]) {
  const g = new InstancedBufferGeometry().copy(new PlaneGeometry(1, 1) as unknown as InstancedBufferGeometry);
  const n = items.length;
  const center = new Float32Array(n * 3), size = new Float32Array(n), rot = new Float32Array(n), alpha = new Float32Array(n), shade = new Float32Array(n);
  items.forEach((b, i) => {
    center.set(b.center, i * 3);
    size[i] = b.size;
    rot[i] = b.rot;
    alpha[i] = b.alpha;
    shade[i] = b.shade;
  });
  g.setAttribute('aCenter', new InstancedBufferAttribute(center, 3));
  g.setAttribute('aSize', new InstancedBufferAttribute(size, 1));
  g.setAttribute('aRot', new InstancedBufferAttribute(rot, 1));
  g.setAttribute('aAlpha', new InstancedBufferAttribute(alpha, 1));
  g.setAttribute('aShade', new InstancedBufferAttribute(shade, 1));
  g.instanceCount = n;
  return g;
}

/** Soft, sun-lit billows (gun smoke, kicked-up dirt). Colours are scene-linear, graded with the rest. */
function Billows({ items, lit, shade, sunMix, renderOrder }: { items: Billboard[]; lit: string; shade: string; sunMix: number; renderOrder: number }) {
  const day = useDaylight();
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: BILLBOARD_VERT,
        fragmentShader: SMOKE_FRAG,
        uniforms: { map: { value: smokeTexture() }, litColor: { value: new Color() }, shadeColor: { value: new Color() } },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  const geometry = useMemo(() => billboardGeometry(items), [items]);
  const sun = day?.sun ?? 1, sky = day?.sky ?? 1;
  material.uniforms.litColor.value.set(lit).lerp(new Color(day?.sunColor ?? '#ffffff'), sunMix).multiplyScalar(0.6 * sun + 0.3 * sky);
  material.uniforms.shadeColor.value.set(shade).multiplyScalar(0.4 * sky);
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={renderOrder} />;
}

/**
 * Gun smoke frozen just after the shot: a dense billow at the muzzle thinning along the line of
 * fire (local +Z, `scale.z` metres long, `scale.x` wide).
 */
function Smoke({ fx, scale }: { fx: Fx; scale: Vec3 }) {
  const items = useMemo(() => {
    const r = rng(fx.seed);
    return Array.from({ length: fx.count }, (): Billboard => {
      const t = Math.pow(r(), 1.8); // most gas stays near the muzzle
      const spread = (0.05 + 0.3 * t) * scale[0];
      return {
        center: [gauss(r) * spread * 0.5, gauss(r) * spread * 0.45 + t * 0.06, t * scale[2]], // warm gas rises a little
        size: fx.size * (0.4 + 0.9 * t) * (0.7 + 0.6 * r()),
        rot: r() * Math.PI * 2,
        alpha: (fx.opacity ?? 0.22) * (1 - 0.65 * t) * (0.6 + 0.4 * r()),
        shade: 0.35 + 0.65 * r(),
      };
    });
  }, [fx.seed, fx.count, fx.size, fx.opacity, scale[0], scale[2]]);
  // Smokeless-powder gas is pale grey; the low sun only warms it slightly.
  return <Billows items={items} lit="#e8e6e2" shade="#9aa0a6" sunMix={0.25} renderOrder={2} />;
}

/**
 * Dirt kicked up by running feet and hooves: low billows clustered behind each `sources` point
 * (world, at ground level), plus a thin drifting layer across the object's box.
 */
function GroundDust({ fx, scale, origin }: { fx: Fx; scale: Vec3; origin: Vec3 }) {
  const items = useMemo(() => {
    const r = rng(fx.seed);
    const sources = (fx.sources ?? []).map((p) => [p[0] - origin[0], p[2] - origin[2]] as const);
    const out: Billboard[] = [];
    for (let i = 0; i < fx.count; i++) {
      const clustered = sources.length > 0 && r() < 0.75;
      const [cx, cz] = clustered ? sources[Math.floor(r() * sources.length)] : [(r() - 0.5) * scale[0], (r() - 0.5) * scale[2]];
      const spread = clustered ? 0.55 : 0.3;
      const size = fx.size * (clustered ? 0.6 + 0.9 * r() : 1 + 1.5 * r());
      out.push({
        center: [cx + gauss(r) * spread, size * 0.32 + Math.abs(gauss(r)) * (clustered ? 0.18 : 0.06) - origin[1], cz + gauss(r) * spread],
        size,
        rot: r() * Math.PI * 2,
        alpha: (fx.opacity ?? 0.2) * (clustered ? 0.6 + 0.4 * r() : 0.35 + 0.3 * r()),
        shade: 0.3 + 0.7 * r(),
      });
    }
    return out;
  }, [fx.seed, fx.count, fx.size, fx.opacity, fx.sources, origin, scale[0], scale[2]]);
  // Dry, sun-bleached topsoil.
  return <Billows items={items} lit="#c9b08c" shade="#7d6a55" sunMix={0.35} renderOrder={1} />;
}

/** Star-shaped glow for the muzzle flash: hot core with a few sharp spikes. */
const flashTexture = (() => {
  let tex: CanvasTexture | null = null;
  return () => {
    if (tex) return tex;
    const N = 128;
    const [c, g] = canvas(N, N);
    const img = g.createImageData(N, N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const dx = (x + 0.5) / N - 0.5, dy = (y + 0.5) / N - 0.5;
        const d = Math.hypot(dx, dy) * 2;
        const ang = Math.atan2(dy, dx);
        const spikes = Math.pow(Math.abs(Math.cos(ang * 3)), 24) * Math.max(0, 1 - d) * 0.8;
        const a = Math.min(1, Math.exp(-d * d * 9) + spikes + Math.max(0, 1 - d) ** 3 * 0.25);
        const i = (y * N + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    g.putImageData(img, 0, 0);
    tex = new CanvasTexture(c);
    return tex;
  };
})();

const FLASH_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 hot;
uniform vec3 cool;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
void main() {
  float a = texture2D(map, vUv).a * vAlpha;
  if (a < 0.002) discard;
  // vShade: 1 = white-hot core, 0 = orange flame tips. Bright enough to feed the bloom pass.
  gl_FragColor = vec4(mix(cool, hot, vShade) * a, 1.0);
}
`;

/**
 * Muzzle flash caught at its peak: a white-hot core at the origin, a tongue of flame along +Z
 * and a few side petals, additively blended, plus a warm point light on the shooter.
 */
function Flash({ fx, scale }: { fx: Fx; scale: Vec3 }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: BILLBOARD_VERT,
        fragmentShader: FLASH_FRAG,
        uniforms: {
          map: { value: flashTexture() },
          hot: { value: new Color('#fff4d6').multiplyScalar(14) },
          cool: { value: new Color('#ff7a1f').multiplyScalar(6) },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );
  const geometry = useMemo(() => {
    const r = rng(fx.seed);
    const k = fx.opacity ?? 1;
    const items: Billboard[] = [{ center: [0, 0, 0.02], size: fx.size, rot: r() * 6.28, alpha: 0.9 * k, shade: 1 }];
    for (let i = 1; i <= 5; i++) {
      const t = i / 5;
      items.push({ center: [gauss(r) * 0.01, gauss(r) * 0.01, t * scale[2]], size: fx.size * (1.1 - 0.8 * t), rot: r() * 6.28, alpha: (0.75 - 0.5 * t) * k, shade: 1 - t });
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + r();
      const d = fx.size * 0.35;
      items.push({ center: [Math.cos(a) * d, Math.sin(a) * d, 0.04], size: fx.size * 0.45, rot: r() * 6.28, alpha: 0.35 * k, shade: 0.3 });
    }
    return billboardGeometry(items);
  }, [fx.seed, fx.size, fx.opacity, scale[2]]);
  return (
    <>
      <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={4} />
      <pointLight position={[0, 0, 0.1]} color="#ffb070" intensity={(fx.opacity ?? 1) * 2.5} distance={3} decay={2} />
    </>
  );
}

/** Sheets of the declaration caught mid-air, each gently curled; volume = the object's box. */
function Leaflets({ fx, scale, origin }: { fx: Fx; scale: Vec3; origin: Vec3 }) {
  const mesh = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(fx.size, fx.size * 1.4, 6, 8);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / fx.size, y = p.getY(i) / (fx.size * 1.4);
      p.setZ(i, (x * x * 0.9 + y * 0.25 * x) * fx.size * 0.35); // curl
    }
    g.computeVertexNormals();
    return g;
  }, [fx.size]);
  const matrices = useMemo(() => {
    const r = rng(fx.seed);
    const out: Matrix4[] = [];
    const e = new Euler(), q = new Quaternion(), s = new Vector3(1, 1, 1);
    // Keep-clear points in the effect's frame (the volume is axis-aligned at `origin`).
    const avoid = (fx.avoid ?? []).map((p) => new Vector3(...p).sub(new Vector3(...origin)));
    const clear = fx.clear ?? 0.8;
    const eye = fx.eye ? new Vector3(...fx.eye).sub(new Vector3(...origin)) : null;
    const seg = new Vector3(), rel = new Vector3();
    // Distance from p to the sight line eye→a (or to a itself without an eye).
    const gap = (a: Vector3, p: Vector3) => {
      if (!eye) return a.distanceTo(p);
      seg.subVectors(a, eye);
      const t = Math.min(1, Math.max(0, rel.subVectors(p, eye).dot(seg) / seg.lengthSq()));
      return p.distanceTo(seg.multiplyScalar(t).add(eye));
    };
    for (let i = 0, tries = 0; i < fx.count && tries < fx.count * 50; tries++) {
      const pos = new Vector3((r() - 0.5) * scale[0], (r() - 0.5) * scale[1], (r() - 0.5) * scale[2]);
      if (avoid.some((a) => gap(a, pos) < clear)) continue;
      i++;
      e.set(r() * Math.PI * 2, r() * Math.PI * 2, r() * Math.PI * 2);
      s.setScalar(0.85 + 0.3 * r());
      out.push(new Matrix4().compose(pos, q.setFromEuler(e), s.clone()));
    }
    return out;
  }, [fx.seed, fx.count, fx.avoid, fx.clear, fx.eye, origin, scale[0], scale[1], scale[2]]);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    m.count = matrices.length;
    matrices.forEach((mat, i) => m.setMatrixAt(i, mat));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [matrices]);
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, fx.count]} castShadow receiveShadow>
      <meshStandardMaterial map={leafletTexture()} side={DoubleSide} roughness={0.85} />
    </instancedMesh>
  );
}

/** Dust motes hanging in the low sunlight; volume = the object's box. */
function Dust({ fx, scale }: { fx: Fx; scale: Vec3 }) {
  const day = useDaylight();
  const geometry = useMemo(() => {
    const r = rng(fx.seed);
    const pos = new Float32Array(fx.count * 3);
    for (let i = 0; i < fx.count; i++) {
      if (fx.taper !== undefined) {
        // View-frustum shaped: local +Z is the viewer's end; the box narrows towards it by `taper`.
        // Uniform in depth, so specks are densest close to the viewer and thin out with distance.
        const d = r();
        const w = fx.taper + (1 - fx.taper) * d;
        pos[i * 3] = (r() - 0.5) * scale[0] * w;
        pos[i * 3 + 1] = (r() - 0.5) * scale[1] * w;
        pos[i * 3 + 2] = (0.5 - d) * scale[2];
      } else {
        pos[i * 3] = (r() - 0.5) * scale[0];
        pos[i * 3 + 1] = (Math.pow(r(), 1.6) - 0.5) * scale[1]; // denser near the ground
        pos[i * 3 + 2] = (r() - 0.5) * scale[2];
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    return g;
  }, [fx.seed, fx.count, fx.taper, scale[0], scale[1], scale[2]]);
  const color = useMemo(() => new Color(), []);
  color.set(day?.sunColor ?? '#ffffff').multiplyScalar((fx.opacity ?? 0.6) * (day?.sun ?? 1));
  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={3}>
      <pointsMaterial
        map={dustTexture()}
        color={color}
        size={fx.size}
        sizeAttenuation
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}

/**
 * Frozen-moment effects. The object's scale defines the effect's volume, so the effect is drawn
 * under an inverse-scale group and builds its own world-sized geometry (no stretched sprites).
 */
export function FrozenFx({ fx, scale, origin }: { fx: Fx; scale: Vec3; origin: Vec3 }) {
  const inv = useMemo(() => scale.map((v) => 1 / (v || 1)) as Vec3, [scale]);
  return (
    <group scale={inv}>
      {fx.type === 'smoke' && <Smoke fx={fx} scale={scale} />}
      {fx.type === 'flash' && <Flash fx={fx} scale={scale} />}
      {fx.type === 'groundDust' && <GroundDust fx={fx} scale={scale} origin={origin} />}
      {fx.type === 'leaflets' && <Leaflets fx={fx} scale={scale} origin={origin} />}
      {fx.type === 'dust' && <Dust fx={fx} scale={scale} />}
    </group>
  );
}
