import { SoftShadows } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, N8AO, SMAA } from '@react-three/postprocessing';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { useEffect, useMemo } from 'react';
import { type Camera, Uniform, Vector2, Vector3 } from 'three';
import { useScene } from '../store/sceneStore';
import type { SceneObject, SceneSettings } from '../types';

type Grade = NonNullable<SceneSettings['cinematic']>['grade'];

/**
 * Final "film" pass: exposure + ACES filmic tone mapping (three.js' fit, so the look matches the
 * renderer's own), then display-referred grading — saturation, a gentle S-curve, split toning
 * (cool shadows / warm highlights), vignette and animated film grain.
 * The sky backdrop is a pre-tone-mapped image, so background pixels (depth = 1) skip tone mapping.
 */
const GRADE_FRAG = /* glsl */ `
uniform float exposure;
uniform float saturation;
uniform float contrast;
uniform vec3 shadowTint;
uniform vec3 highlightTint;
uniform float vignette;
uniform float grain;
uniform float seed;

vec3 rrtOdt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFilmic(vec3 c) {
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(outM * rrtOdt(inM * (c * exposure / 0.6)), 0.0, 1.0);
}
float grainHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 c = depth >= 0.99999 ? inputColor.rgb : acesFilmic(inputColor.rgb);
  // Grade in a perceptual (gamma 2.2) space so the curve and tints act evenly across tones.
  vec3 p = pow(max(c, 0.0), vec3(1.0 / 2.2));
  float l = dot(p, vec3(0.2126, 0.7152, 0.0722));
  p = mix(vec3(l), p, saturation);
  p = mix(p, p * p * (3.0 - 2.0 * p), contrast);
  p += shadowTint * (1.0 - smoothstep(0.0, 0.55, l)) + highlightTint * smoothstep(0.45, 1.0, l);
  vec2 d = (uv - 0.5) * vec2(1.0, 0.8);
  p *= 1.0 - vignette * smoothstep(0.25, 0.75, length(d) * 1.4);
  p += (grainHash(uv * 1024.0 + seed) - 0.5) * grain;
  outputColor = vec4(pow(clamp(p, 0.0, 1.0), vec3(2.2)), inputColor.a);
}
`;

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE_FRAG, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['exposure', new Uniform(1)],
        ['saturation', new Uniform(1)],
        ['contrast', new Uniform(0)],
        ['shadowTint', new Uniform(new Vector3())],
        ['highlightTint', new Uniform(new Vector3())],
        ['vignette', new Uniform(0)],
        ['grain', new Uniform(0)],
        ['seed', new Uniform(0)],
      ]),
    });
  }
}

const hexToTint = (hex: string, amount: number, v: Vector3) => {
  const n = parseInt(hex.replace('#', ''), 16);
  // Centre the colour on grey so the tint shifts hue without changing brightness.
  return v.set(((n >> 16) & 255) / 255 - 0.5, ((n >> 8) & 255) / 255 - 0.5, (n & 255) / 255 - 0.5).multiplyScalar(amount);
};

function GradePass({ grade }: { grade: Grade }) {
  const gl = useThree((s) => s.gl);
  const effect = useMemo(() => new GradeEffect(), []);
  useEffect(() => () => effect.dispose(), [effect]);
  useEffect(() => {
    const u = effect.uniforms;
    u.get('saturation')!.value = grade.saturation;
    u.get('contrast')!.value = grade.contrast;
    hexToTint(grade.shadowTint, grade.tintAmount, u.get('shadowTint')!.value);
    hexToTint(grade.highlightTint, grade.tintAmount, u.get('highlightTint')!.value);
    u.get('vignette')!.value = grade.vignette;
    u.get('grain')!.value = grade.grain;
  }, [effect, grade]);
  useFrame(() => {
    // Exposure stays driven by the HDRI setting (Stage sets the renderer's value).
    effect.uniforms.get('exposure')!.value = gl.toneMappingExposure;
    effect.uniforms.get('seed')!.value = (effect.uniforms.get('seed')!.value + 0.618) % 100;
  });
  return <primitive object={effect} dispose={null} />;
}

/**
 * The bullet's wake as cinema shows it — air has no surface, only the image behind it ripples.
 * A screen-space distortion over the projected wake (a tapered capsule from the bullet's nose back
 * along the line of fire): radial ripples stream back from the bullet, strongest right behind it
 * and fading out, plus a thin shimmering ring around the nose for the supersonic shock cone
 * (6.5 mm Arisaka ≈ 760 m/s, Mach ≈ 2.2, cone half-angle asin(1/M) ≈ 27°).
 */
const WAKE_FRAG = /* glsl */ `
uniform vec2 uA;
uniform vec2 uB;
uniform float uRa;
uniform float uRb;
uniform float uRing;
uniform float uTime;
uniform float uFlow;
uniform float uStrength;
uniform float uAspect;
uniform float uDepthA;

void mainUv(inout vec2 uv) {
  if (uStrength <= 0.0) return;
  // Only what lies behind the bullet ripples; the bullet itself stays crisp.
  if (readDepth(uv) <= uDepthA) return;
  vec2 k = vec2(uAspect, 1.0);
  vec2 p = uv * k, a = uA * k, b = uB * k;
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
  vec2 dv = p - (a + ab * t);
  float d = length(dv);
  float r = mix(uRa, uRb, t);
  vec2 dir = d > 1e-6 ? dv / d : vec2(0.0);
  float body = (1.0 - smoothstep(0.35 * r, r, d)) * (1.0 - smoothstep(0.4, 1.0, t));
  float wave = sin(t * 38.0 - uTime * uFlow * 18.0 + d / r * 5.0)
             + 0.45 * sin(t * 83.0 - uTime * uFlow * 31.0 + atan(dv.y, dv.x) * 3.0);
  vec2 off = dir * wave * body * r * uStrength;
  // Shock ring around the nose.
  vec2 dn = p - a;
  float ln = length(dn);
  float ring = exp(-pow((ln - uRing) / (uRing * 0.1), 2.0));
  off += (ln > 1e-6 ? dn / ln : vec2(0.0)) * ring * uRing * uStrength * 0.25 * sin(uTime * 24.0 + ln * 300.0);
  vec2 moved = uv + off / k;
  // Never pull the bullet (or anything in front of it) into the wake.
  if (readDepth(moved) > uDepthA) uv = moved;
}
`;

class WakeEffect extends Effect {
  constructor() {
    super('WakeEffect', WAKE_FRAG, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>(
        ['uA', 'uB'].map((n) => [n, new Uniform(new Vector2())] as [string, Uniform]).concat(
          ['uRa', 'uRb', 'uRing', 'uTime', 'uFlow', 'uStrength', 'uAspect', 'uDepthA'].map((n) => [n, new Uniform(0)] as [string, Uniform]),
        ),
      ),
    });
  }
}

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpUp = new Vector3();

/** Screen-space radius (in uv-height units) of a sphere of `r` metres at `p`. */
function screenRadius(camera: Camera, p: Vector3, r: number) {
  tmpUp.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(r).add(p).project(camera);
  const c = tmpB.copy(p).project(camera);
  return Math.abs(tmpUp.y - c.y) / 2;
}

function WakeDistortion({ trail, strength }: { trail: NonNullable<SceneObject['trail']>; strength: number }) {
  const effect = useMemo(() => new WakeEffect(), []);
  useEffect(() => () => effect.dispose(), [effect]);
  const geo = useMemo(() => {
    const to = new Vector3(...trail.to);
    const dir = new Vector3(...trail.from).sub(to).normalize(); // bullet → muzzle
    return {
      nose: to.clone().addScaledVector(dir, -0.095),
      tail0: to.clone(),
      tail: to.clone().addScaledVector(dir, Math.min(1.4, new Vector3(...trail.from).distanceTo(to))),
      cone: to.clone().addScaledVector(dir, 0.06), // a little behind the nose, where the cone is ~3 cm wide
    };
  }, [trail.from, trail.to]);
  useFrame(({ camera, clock, size }) => {
    const u = effect.uniforms;
    const a = tmpA.copy(geo.nose).project(camera);
    const visible = a.z < 1 && a.z > -1;
    u.get('uStrength')!.value = visible ? strength : 0;
    if (!visible) return;
    u.get('uA')!.value.set(a.x * 0.5 + 0.5, a.y * 0.5 + 0.5);
    // Depth-buffer value of the bullet's tail (same non-linear 0–1 range as readDepth()).
    u.get('uDepthA')!.value = tmpB.copy(geo.tail0).project(camera).z * 0.5 + 0.5 + 1e-6;
    const b = tmpB.copy(geo.tail).project(camera);
    u.get('uB')!.value.set(b.x * 0.5 + 0.5, b.y * 0.5 + 0.5);
    u.get('uRa')!.value = screenRadius(camera, geo.nose, trail.radius * 0.8);
    u.get('uRb')!.value = screenRadius(camera, geo.tail, trail.radius * 2.2);
    u.get('uRing')!.value = screenRadius(camera, geo.cone, 0.06 * Math.tan((27 * Math.PI) / 180) + 0.01);
    u.get('uTime')!.value = clock.elapsedTime;
    u.get('uFlow')!.value = trail.flow ?? 0.8;
    u.get('uAspect')!.value = size.width / size.height;
  });
  return <primitive object={effect} dispose={null} />;
}

/** Ambient occlusion, bloom, filmic grading and soft sun shadows, configured by `settings.cinematic`. */
export function Cinematic() {
  const c = useScene((s) => s.doc?.settings.cinematic);
  const trail = useScene((s) => s.doc?.objects.find((o) => o.kind === 'trail' && o.visible && o.trail)?.trail);
  if (!c?.enabled) return null;
  return (
    <>
      {c.softShadows > 0 && <SoftShadows size={c.softShadows} samples={12} focus={0.5} />}
      <EffectComposer multisampling={0}>
        <N8AO
          aoRadius={c.ao.radius}
          intensity={c.ao.intensity}
          distanceFalloff={c.ao.falloff}
          quality="medium"
          halfRes
          depthAwareUpsampling
        />
        {trail && (c.wake ?? 0) > 0 && <WakeDistortion trail={trail} strength={c.wake!} />}
        <Bloom intensity={c.bloom.intensity} luminanceThreshold={c.bloom.threshold} luminanceSmoothing={0.2} mipmapBlur />
        <GradePass grade={c.grade} />
        <SMAA />
      </EffectComposer>
    </>
  );
}
