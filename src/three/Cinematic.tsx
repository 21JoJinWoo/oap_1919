import { SoftShadows } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, N8AO, SMAA } from '@react-three/postprocessing';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { useEffect, useMemo } from 'react';
import { Uniform, Vector3 } from 'three';
import { useScene } from '../store/sceneStore';
import type { SceneSettings } from '../types';

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

/** Ambient occlusion, bloom, filmic grading and soft sun shadows, configured by `settings.cinematic`. */
export function Cinematic() {
  const c = useScene((s) => s.doc?.settings.cinematic);
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
        <Bloom intensity={c.bloom.intensity} luminanceThreshold={c.bloom.threshold} luminanceSmoothing={0.2} mipmapBlur />
        <GradePass grade={c.grade} />
        <SMAA />
      </EffectComposer>
    </>
  );
}
