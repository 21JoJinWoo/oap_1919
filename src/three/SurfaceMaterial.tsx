import { useThree } from '@react-three/fiber';
import { use, useMemo } from 'react';
import { MeshStandardMaterial, RepeatWrapping, ShaderChunk, Vector2, type Texture } from 'three';
import { assetUrl } from '../lib/assets';
import type { SceneObject } from '../types';
import { loadKtx2 } from './ktx2';

/**
 * Hides tile repetition (Inigo Quilez, "Texture repetition", technique 3): a low-frequency
 * value noise picks one of eight random UV offsets per region and blends neighbouring regions.
 * Offsets are translations only, so tangent-space normals stay valid. Sampling uses the
 * original UV gradients to keep mip selection seamless across the offset boundaries.
 */
const NO_TILE = /* glsl */ `
float ntHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float ntNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(ntHash(i), ntHash(i + vec2(1.0, 0.0)), u.x), mix(ntHash(i + vec2(0.0, 1.0)), ntHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec4 noTile(sampler2D s, vec2 uv) {
  float l = ntNoise(uv * 0.37) * 8.0;
  float ia = floor(l);
  vec2 offa = sin(vec2(3.0, 7.0) * ia), offb = sin(vec2(3.0, 7.0) * (ia + 1.0));
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  return mix(textureGrad(s, uv + offa, dx, dy), textureGrad(s, uv + offb, dx, dy), smoothstep(0.2, 0.8, fract(l)));
}
`;

function noTileMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NO_TILE}`)
      .replace(
        '#include <map_fragment>',
        ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'noTile( map, vMapUv )') +
          // Broad brightness variation so the ground does not read as one flat swatch.
          '\n#ifdef USE_MAP\n diffuseColor.rgb *= mix(0.86, 1.1, ntNoise(vMapUv * 0.06));\n#endif\n',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        ShaderChunk.roughnessmap_fragment.replace('texture2D( roughnessMap, vRoughnessMapUv )', 'noTile( roughnessMap, vRoughnessMapUv )'),
      )
      .replace(
        '#include <aomap_fragment>',
        ShaderChunk.aomap_fragment.replace('texture2D( aoMap, vAoMapUv )', 'noTile( aoMap, vAoMapUv )'),
      )
      .replace(
        '#include <normal_fragment_maps>',
        ShaderChunk.normal_fragment_maps.replace('texture2D( normalMap, vNormalMapUv )', 'noTile( normalMap, vNormalMapUv )'),
      );
  };
  return m;
}

const NONE = Promise.resolve(null);

export function SurfaceMaterial({ surface, size }: { surface: NonNullable<SceneObject['surface']>; size: [number, number] }) {
  const gl = useThree((s) => s.gl);
  const map = use(loadKtx2(gl, assetUrl(surface.color)));
  const normal = use(surface.normal ? loadKtx2(gl, assetUrl(surface.normal)) : NONE);
  const orm = use(surface.orm ? loadKtx2(gl, assetUrl(surface.orm)) : NONE);

  const material = useMemo(() => {
    const m = noTileMaterial();
    const repeat = new Vector2(size[0] / surface.tile, size[1] / surface.tile);
    const anisotropy = gl.capabilities.getMaxAnisotropy();
    const setup = (t: Texture) => {
      t.wrapS = t.wrapT = RepeatWrapping;
      t.repeat.copy(repeat);
      t.anisotropy = anisotropy;
      t.needsUpdate = true;
    };
    setup(map);
    m.map = map;
    if (normal) {
      setup(normal);
      m.normalMap = normal;
      // KTX2 textures are not flipped on upload, so the image's V runs opposite to the
      // plane's UV V; negating Y keeps the OpenGL-convention normals pointing the right way.
      const s = surface.normalScale ?? 1;
      m.normalScale.set(s, -s);
    }
    if (orm) {
      setup(orm);
      m.roughnessMap = orm;
      m.aoMap = orm;
    }
    return m;
  }, [gl, map, normal, orm, size[0], size[1], surface.tile, surface.normalScale]);

  return <primitive object={material} attach="material" />;
}
