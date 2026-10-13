import { ShaderChunk } from 'three';

/**
 * Turns three.js' linear distance fog into a ground-hugging haze: the distance term
 * (smoothstep fogNear → fogFar) is weighted by exp(-height / HAZE_HEIGHT), so dust and
 * haze lie low over the plaza while roofs and treetops stay comparatively clear.
 * `HAZE_TOP` keeps a fraction of plain distance fog at any height for aerial perspective.
 * Patched once, globally, before any material compiles.
 */
const HAZE_HEIGHT = '2.2';
const HAZE_TOP = '0.35';

ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogWorldY;
#endif
`;

ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec4 fogWorld = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    fogWorld = batchingMatrix * fogWorld;
  #endif
  #ifdef USE_INSTANCING
    fogWorld = instanceMatrix * fogWorld;
  #endif
  vFogWorldY = ( modelMatrix * fogWorld ).y;
#endif
`;

ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogWorldY;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;

ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  fogFactor *= mix( exp( - max( vFogWorldY, 0.0 ) / ${HAZE_HEIGHT} ), 1.0, ${HAZE_TOP} );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
